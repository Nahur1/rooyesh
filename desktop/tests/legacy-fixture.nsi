Unicode true
Name "Nava upgrade test fixture"
OutFile "${TEST_OUTPUT}\legacy-fixture.exe"
RequestExecutionLevel user
SilentInstall silent
!include LogicLib.nsh
!include FileFunc.nsh
!define LEGACY_GUID "9a31e201-1f01-58b0-b8f0-f1403a53c121"
!define LEGACY_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${LEGACY_GUID}"
Var arguments
Var option
Function SelectScope
  SetRegView 64
  SetShellVarContext current
  ${GetParameters} $arguments
  ClearErrors
  ${GetOptions} $arguments "/allusers" $option
  ${IfNot} ${Errors}
    SetShellVarContext all
  ${EndIf}
FunctionEnd
Section
  Call SelectScope
  CreateDirectory "$INSTDIR"
  FileOpen $0 "$INSTDIR\Nava.exe" w
  FileWrite $0 "Legacy application test fixture"
  FileClose $0
  WriteUninstaller "$INSTDIR\Uninstall Nava.exe"
  WriteRegStr SHELL_CONTEXT "Software\${LEGACY_GUID}" InstallLocation "$INSTDIR"
  WriteRegStr SHELL_CONTEXT "${LEGACY_KEY}" DisplayName "Nava"
  WriteRegStr SHELL_CONTEXT "${LEGACY_KEY}" UninstallString '"$INSTDIR\Uninstall Nava.exe"'
SectionEnd
Function un.SelectScope
  SetRegView 64
  SetShellVarContext current
  ${GetParameters} $arguments
  ClearErrors
  ${GetOptions} $arguments "/allusers" $option
  ${IfNot} ${Errors}
    SetShellVarContext all
  ${EndIf}
FunctionEnd
Section "Uninstall"
  Call un.SelectScope
  IfFileExists "$INSTDIR\fail-uninstall" 0 +3
    SetErrorLevel 23
    Quit
  ClearErrors
  ${GetOptions} $arguments "/KEEP_APP_DATA" $option
  ${If} ${Errors}
    SetErrorLevel 24
    Quit
  ${EndIf}
  ClearErrors
  ${GetOptions} $arguments "--updated" $option
  ${If} ${Errors}
    SetErrorLevel 25
    Quit
  ${EndIf}
  Delete "$INSTDIR\Nava.exe"
  Delete "$INSTDIR\Uninstall Nava.exe"
  DeleteRegKey SHELL_CONTEXT "${LEGACY_KEY}"
  DeleteRegKey SHELL_CONTEXT "Software\${LEGACY_GUID}"
  RMDir "$INSTDIR"
SectionEnd
