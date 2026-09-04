; 安装时选数据目录（owner 2026-09-04 定）。
;
; 为什么放在安装期：这一刻**还没有任何加密数据**，所以「选在哪儿」是免费的 ——
; 不需要搬移、不需要校验一致性、失败也没有半份数据留下。装完之后再改也可以
; （设置 › 存储位置），但那条路要重启并逐文件核对（TD-039）。
;
; 我们写的是**一个指针文件**，不是数据本身：
;   %APPDATA%\Ruyin\location.json  ->  { "dataDir": "<用户选的目录>" }
; 应用启动时读它（apps/shell/src/main.ts 的 pointedDataDir），守护进程按它开库。
; 路径而已，没有秘密 —— 客户端零秘密这条规矩在这儿也成立。
;
; 三条自我约束：
;   1. **已有指针就不碰。** 升级安装时用户的数据已经在某处，覆盖指针等于让应用
;      对着一个空目录启动，而他的东西还在原地 —— 那看起来就像数据丢了。
;   2. **只在用户改过默认值时才写。** 没改就什么也不写，应用走它自己的默认
;      （userData\data），少一处需要两边保持一致的状态。
;   3. **写不进去就当没选。** 指针写失败不阻断安装：应用会用默认目录起来，
;      用户仍然可以在设置里改。安装器不该因为一个可选项而失败。

; nsDialogs 与 LogicLib **必须自己 include**：electron-builder 的模板不保证
; 引过它们，而 `${NSD_*}` / `${If}` 只是宏 —— 没引进来时它们不是「运行时报错」，
; 而是 makensis 在编译期就停下（第一次踩到的是下面那个 Function 里的用法，因为
; `!macro` 体要等到被插入时才展开，于是报的行号离真正缺失的那一行很远）。
; 两个头文件都有自己的重复保护，再引一次是安全的。
!include nsDialogs.nsh
!include LogicLib.nsh

Var RuyinDataDirPage
Var RuyinDataDirField
Var RuyinDataDirValue
Var RuyinPointerFile

!macro preInit
  ; 装机态的 userData 是 %APPDATA%\Ruyin（main.ts 里 app.setName("Ruyin")），
  ; 指针跟它放在一起：它必须待在一个**不会跟着数据搬走**的地方。
  StrCpy $RuyinPointerFile "$APPDATA\Ruyin\location.json"
!macroend

!macro customPageAfterChangeDir
  ; 已经有指针（升级、或重装到同一个用户）：这一页不出现。数据在哪儿由那份
  ; 指针说，安装器不参与。
  IfFileExists "$RuyinPointerFile" skipDataDirPage 0

  nsDialogs::Create 1018
  Pop $RuyinDataDirPage
  ${If} $RuyinDataDirPage == error
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "选择数据目录" "业务数据与密钥放在哪里。装好之后也可以在设置里改。"

  ${NSD_CreateLabel} 0 0 100% 34u "RUYIN 的业务数据（项目库、产品库、密钥）会放在下面这个目录。数据整库加密，密钥按当前 Windows 用户封装 —— 所以请选一个只有你自己使用的位置，不要选可移动磁盘或共享目录。"
  Pop $0

  ${NSD_CreateDirRequest} 0 40u 75% 12u "$LOCALAPPDATA\Ruyin\data"
  Pop $RuyinDataDirField

  ${NSD_CreateButton} 80% 39u 20% 14u "浏览…"
  Pop $0
  ${NSD_OnClick} $0 RuyinBrowseDataDir

  nsDialogs::Show
  skipDataDirPage:
!macroend

Function RuyinBrowseDataDir
  ${NSD_GetText} $RuyinDataDirField $0
  nsDialogs::SelectFolderDialog "选择 RUYIN 的数据目录" "$0"
  Pop $1
  ${If} $1 != error
    ${NSD_SetText} $RuyinDataDirField "$1"
  ${EndIf}
FunctionEnd

!macro customInstall
  ; 这一页没出现过（升级）时 $RuyinDataDirField 是空的 —— 那就什么也不写。
  ${If} $RuyinDataDirField != ""
    ${NSD_GetText} $RuyinDataDirField $RuyinDataDirValue
  ${Else}
    StrCpy $RuyinDataDirValue ""
  ${EndIf}

  ${If} $RuyinDataDirValue != ""
  ${AndIf} $RuyinDataDirValue != "$LOCALAPPDATA\Ruyin\data"
    ; 用户真的改过默认值才落指针。JSON 里的反斜杠要转义 —— 直接写
    ; "D:\RuyinData" 会变成一个非法的 JSON 字符串，应用读不出来就回落默认，
    ; 于是用户的选择静默失效。
    Push "$RuyinDataDirValue"
    Call RuyinEscapeBackslashes
    Pop $R0
    CreateDirectory "$APPDATA\Ruyin"
    ClearErrors
    FileOpen $R1 "$RuyinPointerFile" w
    ${IfNot} ${Errors}
      FileWrite $R1 '{$\n  "dataDir": "$R0"$\n}$\n'
      FileClose $R1
      ; 目录本身也建出来：让「可写」这件事在安装期就被验证，而不是等到第一次
      ; 启动。建不出来也不拦安装 —— 应用会用默认目录起来。
      CreateDirectory "$RuyinDataDirValue"
    ${EndIf}
  ${EndIf}
!macroend

; "D:\a\b" -> "D:\\a\\b"。NSIS 没有字符串替换，逐字符扫一遍。
Function RuyinEscapeBackslashes
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  StrCpy $R1 ""
  StrCpy $R2 0
  loop:
    StrCpy $R3 $R0 1 $R2
    StrCmp $R3 "" done
    StrCmp $R3 "\" 0 +3
      StrCpy $R1 "$R1\\"
      Goto next
    StrCpy $R1 "$R1$R3"
    next:
    IntOp $R2 $R2 + 1
    Goto loop
  done:
  StrCpy $R0 $R1
  Pop $R3
  Pop $R2
  Pop $R1
  Exch $R0
FunctionEnd
