; Registers the valkama: scheme for this user, which is what a click on a toast opens.
;
; electron-builder's `protocols` option is not it: its NSIS target reads only
; `fileAssociations`, and `protocols` reaches the macOS, AppX and Linux targets alone.
; The installer rather than the app, so it is true before the first start and an
; uninstall takes it away. The address arrives as one quoted argument, and
; `desktop/open_path.js` decides what happens with it.

!macro customInstall
  WriteRegStr HKCU "Software\Classes\valkama" "" "URL:Valkama"
  WriteRegStr HKCU "Software\Classes\valkama" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\valkama\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\valkama\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\valkama"
  ${endIf}
!macroend
