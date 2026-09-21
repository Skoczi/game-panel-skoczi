FROM docker:29-cli
RUN apk add --no-cache python3 bash coreutils
COPY deploy/updater/runner.py /opt/pro-updater/runner.py
ENTRYPOINT ["python3", "/opt/pro-updater/runner.py"]
