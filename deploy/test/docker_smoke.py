#!/usr/bin/env python3
"""Disposable Linux Docker acceptance for the standard deployment transaction.
Uses small HTTP fixture services, real Compose/images/mounts and real rollback copies.
Run only inside the isolated acceptance container, never against an existing install.
"""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import uuid

path=Path(__file__).resolve().parents[1]/'upgrade.py'
spec=importlib.util.spec_from_file_location('upgrade',path);up=importlib.util.module_from_spec(spec);spec.loader.exec_module(up)
if os.environ.get('GP_DEPLOY_DOCKER_TEST')!='1':raise SystemExit('Set GP_DEPLOY_DOCKER_TEST=1 inside the disposable Linux runtime')
root=Path(tempfile.mkdtemp(prefix='gp-deploy-')).resolve();project='gpdeploy'+uuid.uuid4().hex[:8]
source=root.parent/(root.name+'-candidate')
try:
 for name in ['app/backend','app/frontend','data','servers','deploy']:(root/name).mkdir(parents=True)
 for service,port in [('backend',3001),('frontend',8080)]:
  directory=root/'app'/service
  (directory/'package.json').write_text('{"version":"1.5.0"}')
  (directory/'server.js').write_text(f"require('http').createServer((q,r)=>{{r.end('ok')}}).listen({port},'0.0.0.0');")
  (directory/'Dockerfile').write_text('FROM node:24-alpine3.24\nWORKDIR /app/backend\nCOPY '+service+'/package.json '+service+'/server.js ./\nCMD ["node","server.js"]\n')
 (root/'data/account').write_text('preserved-account')
 (root/'servers/game').write_text('preserved-game')
 (root/'deploy/.env').write_text('JWT_SECRET=fixture-secret\nGAMEPANEL_REPOSITORY_URL=https://github.com/ovh/game-panel.git\n')
 (root/'deploy/compose.yml').write_text(f'''services:
  backend:
    build:
      context: ../app
      dockerfile: backend/Dockerfile
    environment:
      PORT: "3001"
      JWT_SECRET: "${{JWT_SECRET}}"
      GAMEPANEL_APP_ROOT: "{root}"
      GAMEPANEL_REPOSITORY_URL: "${{GAMEPANEL_REPOSITORY_URL}}"
    volumes:
      - "../data:/data"
      - "../servers:{root}/servers"
      - "/var/run/docker.sock:/var/run/docker.sock"
  frontend:
    build:
      context: ../app
      dockerfile: frontend/Dockerfile
  traefik:
    image: node:24-alpine3.24
    command: ["node", "-e", "setInterval(()=>{{}},1000)"]
''')
 app=up.Upgrade(str(root),project)
 app.compose('up','-d','--build',capture=False)
 app.healthy('1.5.0')
 original_proxy=app.compose('ps','-q','traefik')
 source.mkdir()
 for name in up.SOURCE_ITEMS:
  p=source/name
  if (root/'app'/name).exists():shutil.copytree(root/'app'/name,p)
  elif name.startswith('.') or name in ('LICENSE','LICENSE-2.0.txt','NOTICE','CHANGELOG.md','README.md'):p.write_text('fixture')
  else:p.mkdir()
 for service in ('backend','frontend'):(source/service/'package.json').write_text('{"version":"2.0.50"}')
 (source/'deploy/updater').mkdir()
 (source/'deploy/updater/Dockerfile').write_text('FROM node:24-alpine3.24\nCMD ["true"]\n')
 app.apply(source)
 assert up.version(root/'app')=='2.0.50'
 assert (root/'data/account').read_text()=='preserved-account'
 assert (root/'servers/game').read_text()=='preserved-game'
 assert app.compose('ps','-q','traefik')==original_proxy
 snapshot=next((root/'pro-update-backups').iterdir())
 app.rollback(snapshot)
 assert up.version(root/'app')=='1.5.0'
 assert (root/'data/account').read_text()=='preserved-account'
 assert (root/'servers/game').read_text()=='preserved-game'
 assert app.compose('ps','-q','traefik')==original_proxy
 print('PASS: real Compose upgrade 1.5.0 → 2.0.50 and rollback; data and proxy retained')
finally:
 subprocess.run(['docker','compose','--project-directory',str(root/'deploy'),'--env-file',str(root/'deploy/.env'),'-p',project,'-f',str(root/'deploy/compose.yml'),'down','--volumes','--remove-orphans'],check=False)
 shutil.rmtree(root);shutil.rmtree(source,ignore_errors=True)
