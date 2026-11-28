#!/usr/bin/env bash
# Lab only: puts the newest signed development installer on Surfiena for one Windows profile (default BeaconTest),
# installs it silently in that profile's session, brings its sign-in and boot services up to it over the elevated SSH
# login, restarts its host, and keeps the lab's cable-only media rules on the new program paths. Works while locked.
set -euo pipefail
cd /d/Dev/Beacon-Remote
PROFILE_NAME=${LAB_PROFILE:-BeaconTest}
# The SSH (administrator) account's lab folder on the laptop, e.g. C:\Users\<admin>\BeaconLab; kept out of the repo.
ADMIN_LAB=${LAB_ADMIN_ROOT:?Set LAB_ADMIN_ROOT to the BeaconLab folder of the SSH account on the laptop}
S=scripts/lab
export LAB_REMOTE_ROOT="C:/Users/$PROFILE_NAME/BeaconLab"
SETUP=$(ls -t dist/BeaconRemoteSetup-*-signin-media.exe | head -1)
echo "deploying $(basename "$SETUP") to $PROFILE_NAME"
scp -q "$SETUP" "beacon-surfiena-link:C:/Users/$PROFILE_NAME/BeaconLab/BeaconRemoteSetup.exe"
scp -q scripts/lab/Repair-LabSignIn.ps1 scripts/lab/Limit-LabMediaToCable.ps1 beacon-surfiena-link:BeaconLab/
node scripts/lab/lab.mjs launch "C:/Users/$PROFILE_NAME/BeaconLab/BeaconRemoteSetup.exe" --silent >/dev/null
for i in $(seq 1 30); do
  sleep 2
  n=$(ssh beacon-surfiena-link "powershell -NoProfile -Command \"(Get-Process BeaconRemoteSetup* -EA SilentlyContinue | Measure-Object).Count\"" | tr -d '\r')
  [ "$n" = "0" ] && break
done
ssh beacon-surfiena-link "powershell -NoProfile -ExecutionPolicy Bypass -File $ADMIN_LAB\\Repair-LabSignIn.ps1 -Profile $PROFILE_NAME"
# Each repair installs the sign-in agent in a new version folder; the cable-only rules follow the programs.
ssh beacon-surfiena-link "powershell -NoProfile -ExecutionPolicy Bypass -Command \"\$p = (Get-Process beacon-remote-agent | Where-Object Path -like '*Beacon Remote Sign-in*' | Sort-Object StartTime | Select-Object -Last 1).Path; & $ADMIN_LAB\\Limit-LabMediaToCable.ps1 -Program \$p -RuleName BeaconLab-signin-cable-only-in; & $ADMIN_LAB\\Limit-LabMediaToCable.ps1 -Program 'C:\\Users\\$PROFILE_NAME\\AppData\\Local\\Programs\\Beacon Remote\\beacon-remote-session.exe' -RuleName BeaconLab-bt-session-cable-only-in\""
node scripts/lab/lab.mjs launch "C:/Users/$PROFILE_NAME/AppData/Local/Programs/Beacon Remote/beacon-remote-host.exe" --background >/dev/null || true
sleep 4
ssh beacon-surfiena-link "powershell -NoProfile -Command \"Get-Process beacon-remote-host -EA SilentlyContinue | Format-Table Id,SessionId,StartTime -AutoSize | Out-String\""
