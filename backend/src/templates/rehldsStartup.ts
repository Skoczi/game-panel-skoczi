// Compatibility for published, immutable ReHLDS snapshots. Only the exact former
// panel-owned hostname writer is removed; arbitrary administrator scripts are untouched.
const validation = "[[ \"$SERVER_NAME\" != *\\\"* && \"$SERVER_NAME\" != *\\\\* && \"$SERVER_NAME\" != *';'* && \"$SERVER_NAME\" != *$'\\n'* && \"$SERVER_NAME\" != *$'\\r'* ]] || ( echo 'Server name cannot contain quotes, backslashes, semicolons or line breaks'; exit 2; )\n";
const writer = "config=\"cstrike/$CFG\"\n[[ ! -L \"$config\" ]] || ( echo 'Config must not be a symbolic link'; exit 2; )\n[[ -f \"$config\" ]] || touch \"$config\"\n# Keep the owner's settings; update only hostname and remove an exact self-include.\n[[ -e \"$config.bak\" ]] || cp -p -- \"$config\" \"$config.bak\"\ntmp=$(mktemp \"cstrike/.hostname.XXXXXXXX\")\ntrap 'rm -f -- \"$tmp\"' EXIT\ncp -p -- \"$config\" \"$tmp\"\nwritten=0\nwhile IFS= read -r line || [[ -n \"$line\" ]]; do\n  if [[ \"$line\" =~ ^[[:space:]]*[Hh][Oo][Ss][Tt][Nn][Aa][Mm][Ee][[:space:]] ]]; then\n    (( written )) || printf 'hostname \"%s\"\\n' \"$SERVER_NAME\"\n    written=1\n  elif [[ \"$line\" =~ ^[[:space:]]*exec[[:space:]]+\\\"?\"$CFG\"\\\"?[[:space:]]*$ ]]; then\n    continue\n  else\n    printf '%s\\n' \"$line\"\n  fi\ndone < \"$config\" > \"$tmp\"\n(( written )) || printf 'hostname \"%s\"\\n' \"$SERVER_NAME\" >> \"$tmp\"\nmv -- \"$tmp\" \"$config\"\ntrap - EXIT\n";
export function normalizeRehldsStartup(argv: string[]): string[] {
    if (argv[0] !== '/bin/bash' || argv[1] !== '-c' || !argv[2]?.includes(writer) || !argv[2].includes(validation)) return argv;
    const result = [...argv];
    result[2] = result[2].replace(validation, '').replace(writer, '');
    return result;
}
