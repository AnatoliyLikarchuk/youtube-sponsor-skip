#!/bin/sh
# Safari forgets unsigned extensions after a restart. Run this after turning on
# Settings → Developer → "Allow unsigned extensions": it re-registers the
# extension so Safari shows it in Settings → Extensions again.
set -e
APPEX="/Applications/YouTube Sponsor Skip.app/Contents/PlugIns/YouTube Sponsor Skip Extension.appex"
pluginkit -a "$APPEX"
pluginkit -e use -i com.anatoliy.YouTubeSponsorSkip.Extension
open -g "/Applications/YouTube Sponsor Skip.app"
echo "Done. Reopen Safari Settings → Extensions."
