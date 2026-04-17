from __future__ import annotations

from . import manifests


TOP_LEVEL_COMMANDS = [
    "build",
    "completion",
    "config",
    "deploy",
    "emulator",
    "manifest",
    "package",
    "runtime",
    "test",
]


def bash_completion() -> str:
    services = " ".join(sorted(service.name for service in manifests.load_services()))
    profiles = " ".join(sorted(profile.name for profile in manifests.load_profiles()))
    tests = " ".join(sorted(test.name for test in manifests.load_tests()))
    commands = " ".join(TOP_LEVEL_COMMANDS)
    return f"""# shellcheck shell=bash
_trakrai_devtool()
{{
  local cur prev
  COMPREPLY=()
  cur="${{COMP_WORDS[COMP_CWORD]}}"
  prev="${{COMP_WORDS[COMP_CWORD-1]}}"
  case "$prev" in
    --service)
      COMPREPLY=( $(compgen -W "{services}" -- "$cur") )
      return 0
      ;;
    --profile)
      COMPREPLY=( $(compgen -W "{profiles}" -- "$cur") )
      return 0
      ;;
    --test|--test-name)
      COMPREPLY=( $(compgen -W "{tests}" -- "$cur") )
      return 0
      ;;
  esac
  COMPREPLY=( $(compgen -W "{commands}" -- "$cur") )
}}
complete -F _trakrai_devtool python3
complete -F _trakrai_devtool python
"""


def zsh_completion() -> str:
    commands = " ".join(TOP_LEVEL_COMMANDS)
    services = " ".join(sorted(service.name for service in manifests.load_services()))
    profiles = " ".join(sorted(profile.name for profile in manifests.load_profiles()))
    tests = " ".join(sorted(test.name for test in manifests.load_tests()))
    return f"""#compdef python3 python
local -a commands services profiles tests
commands=({commands})
services=({services})
profiles=({profiles})
tests=({tests})

case $words[$CURRENT-1] in
  --service)
    compadd -- $services
    ;;
  --profile)
    compadd -- $profiles
    ;;
  --test|--test-name)
    compadd -- $tests
    ;;
  *)
    compadd -- $commands
    ;;
esac
"""


def fish_completion() -> str:
    lines = []
    for command in TOP_LEVEL_COMMANDS:
        lines.append(f"complete -c python3 -f -a {command}")
    for service in sorted(service.name for service in manifests.load_services()):
        lines.append(f"complete -c python3 -l service -a {service}")
    for profile in sorted(profile.name for profile in manifests.load_profiles()):
        lines.append(f"complete -c python3 -l profile -a {profile}")
    for test in sorted(test.name for test in manifests.load_tests()):
        lines.append(f"complete -c python3 -l test -a {test}")
        lines.append(f"complete -c python3 -l test-name -a {test}")
    return "\n".join(lines) + "\n"
