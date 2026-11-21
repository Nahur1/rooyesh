; Keep the Rooyesh appId stable. electron-builder handles same-app upgrades.
; These hooks also migrate the registered pre-rename Nava installation.
!define NAVA_GUID "9a31e201-1f01-58b0-b8f0-f1403a53c121"
!define NAVA_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${NAVA_GUID}"

!macro RequirePreviousUninstallSuccess
  ${If} ${Errors}
    MessageBox MB_OK|MB_ICONSTOP "Unable to start the previous version's uninstaller. Installation has stopped." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
  ${If} $R0 != 0
    MessageBox MB_OK|MB_ICONSTOP "The previous version could not be removed (code $R0). Close the application and try again." /SD IDOK
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!ifndef BUILD_UNINSTALLER
  Var legacyRoot
  Var legacyCommand
  Var legacyExe
  Var legacyDir
  Var legacyTempExe
  Var legacyMode
  Var legacyMachineCommand
!endif

!macro customHeader
  !ifndef BUILD_UNINSTALLER

    Function RemoveLegacyNava
      Pop $legacyRoot
      Push $R0
      ${If} $legacyRoot == "HKEY_CURRENT_USER"
        ReadRegStr $legacyCommand HKCU "${NAVA_UNINSTALL_KEY}" "UninstallString"
        StrCpy $legacyMode "/currentuser"
      ${Else}
        ReadRegStr $legacyCommand SHELL_CONTEXT "${NAVA_UNINSTALL_KEY}" "UninstallString"
        ${If} $installMode == "all"
          StrCpy $legacyMode "/allusers"
        ${Else}
          StrCpy $legacyMode "/currentuser"
        ${EndIf}
      ${EndIf}

      ${If} $legacyCommand != ""
        ; electron-builder writes a quoted uninstaller path, including custom locations.
        Push $legacyCommand
        Call GetInQuotes
        Pop $legacyExe
        ${If} $legacyExe == ""
          MessageBox MB_OK|MB_ICONSTOP "The registered Nava uninstaller path is invalid. Installation has stopped." /SD IDOK
          SetErrorLevel 2
          Quit
        ${EndIf}
        Push $legacyExe
        Call GetFileParent
        Pop $legacyDir

        InitPluginsDir
        StrCpy $legacyTempExe "$PLUGINSDIR\nava-uninstaller.exe"
        StrCpy $R0 0
        ClearErrors
        CopyFiles /SILENT "$legacyExe" "$legacyTempExe"
        !insertmacro RequirePreviousUninstallSuccess
        DetailPrint "Removing the previous Nava installation..."
        ; --updated and /KEEP_APP_DATA preserve the profile shared with Rooyesh.
        ; _?= runs synchronously against the registered installation directory.
        ClearErrors
        ExecWait '"$legacyTempExe" /S /KEEP_APP_DATA --updated $legacyMode _?=$legacyDir' $R0
        !insertmacro RequirePreviousUninstallSuccess
      ${EndIf}
      ClearErrors
      Pop $R0
    FunctionEnd
  !endif
!macroend

!macro customInit
  ; A machine-wide legacy install must be replaced in machine-wide mode.
  ReadRegStr $legacyMachineCommand HKLM "${NAVA_UNINSTALL_KEY}" "UninstallString"
  ${If} $legacyMachineCommand != ""
    StrCpy $hasPerMachineInstallation "1"
  ${EndIf}
!macroend

!macro customInstallMode
  !ifndef BUILD_UNINSTALLER
    ReadRegStr $legacyMachineCommand HKLM "${NAVA_UNINSTALL_KEY}" "UninstallString"
    ${If} $legacyMachineCommand != ""
      StrCpy $isForceMachineInstall "1"
    ${EndIf}
  !endif
!macroend

; These hooks run after the normal Rooyesh uninstall and before extracting
; the new application's files, even when reusing the legacy installation folder.
!macro customUnInstallCheck
  !insertmacro RequirePreviousUninstallSuccess
  Push "SHELL_CONTEXT"
  Call RemoveLegacyNava
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro RequirePreviousUninstallSuccess
  Push "HKEY_CURRENT_USER"
  Call RemoveLegacyNava
!macroend
