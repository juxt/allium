#!/bin/sh
# Wrapper for Aider's --lint-cmd. Aider passes the file path as a CLI argument.
# Only run allium check on .allium files; exit 0 for everything else.
case "$1" in
  *.allium) exec allium check "$1" ;;
  *) exit 0 ;;
esac
