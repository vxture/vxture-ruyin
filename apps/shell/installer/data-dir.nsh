; 安装时选数据目录（owner 2026-09-04 定）。
;
; 为什么放在安装期：这一刻**还没有任何加密数据**，所以「选在哪儿」是免费的 ——
; 不需要搬移、不需要校验一致性、失败也没有半份数据留下。装完之后再改也可以
; （设置 › 存储位置），但那条路要重启并逐文件核对（TD-039）。
;
; 我们写的是**一个指针文件**，不是数据本身：
;   %APPDATA%\Ruyin\location.json  ->  { "dataDir": "<用户选的目录>" }
; 守护进程启动时读它决定用哪个目录（data-location.ts 的 resolveDataDir），然后
; 才开库。没有指针时的默认位置是**本地** %LOCALAPPDATA%\Ruyin\data；老机器上
; 数据还在漫游那边的，守护进程会写一条指针把它钉在原处，一个字节都不搬。
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

; `preInit` 在两遍里都会被插进 `.onInit`（installer.nsi），所以指针路径这个
; 变量必须留在守卫外面。另外三个只在安装器那一遍用得到 —— 留在外面会换来
; `warning 6001: Variable not referenced or never set, wasting memory`，同样
; 是 -WX 下的构建失败。
Var RuyinPointerFile

!macro preInit
  ; 装机态的 userData 是 %APPDATA%\Ruyin（main.ts 里 app.setName("Ruyin")），
  ; 指针跟它放在一起：它必须待在一个**不会跟着数据搬走**的地方。
  StrCpy $RuyinPointerFile "$APPDATA\Ruyin\location.json"
!macroend

; 这个钩子的位置在**页面声明区**（app-builder-lib 的 assistedInstaller.nsh 把它
; 插在 MUI 的目录页与安装页之间），所以这里只能声明一页，不能直接写指令 ——
; 对话框的创建要放进页面回调里。本地用 makensis 试过：直接写指令会得到
; `command IfFileExists not valid outside Section or Function`。
;
; 顺带一个有用的性质：`Page custom` 是下面两个 Function 唯一的引用来源。万一这个
; 钩子将来没有被插入（换了 electron-builder、改了 oneClick），makensis 会报
; `warning 6010: function not referenced`，而 electron-builder 是 -WX 编译的 ——
; 于是「这一页悄悄没出现」会变成一次构建失败，而不是装机时才被发现。
!macro customPageAfterChangeDir
  Page custom RuyinDataDirPageShow
!macroend

; **卸载器那一遍不要这些函数。** electron-builder 编两次：安装器一遍、卸载器一
; 遍，两遍共用同一份头部（也就是本文件）。卸载器那一遍里 app-builder-lib 用
; `!ifndef BUILD_UNINSTALLER` 把所有页面与 `customInstall` 全部排除，于是这里的
; 函数没人引用 —— 而 electron-builder 是 -WX 编译，`warning 6010: function not
; referenced` 直接成为构建失败。CI 上连着两次红都是这一条。
!ifndef BUILD_UNINSTALLER

Var RuyinDataDirPage
Var RuyinDataDirField
Var RuyinDataDirValue

Function RuyinDataDirPageShow
  ; 已经有指针（升级、或重装到同一个用户）：这一页不出现。数据在哪儿由那份
  ; 指针说，安装器不参与。
  IfFileExists "$RuyinPointerFile" skipDataDirPage 0

  ; **有数据但没有指针**，也不出现。这不是假想：指针文件是这一版才有的东西，
  ; 所以每一个从旧版升级上来的用户都正好是这个状态（本机 2026-09-05 实测就是
  ; 如此：`%APPDATA%\Ruyin\data\runtime\master.key.dpapi` 在，指针不在）。
  ; 那时候让他在这一页改目录，应用会去新的空目录起来，而他的项目库连同解开
  ; 它们的主密钥一起留在原处、界面上看不见 —— 那就是「升级之后东西没了」。
  ; 换目录要走设置里那条会真的搬移的路（TD-039），不是装机时改个指针。
  IfFileExists "$APPDATA\Ruyin\data\runtime\*.*" skipDataDirPage 0
  ; 新的默认位置（本地 AppData）那儿有数据也一样跳过 —— 重装到同一台机器时，
  ; 这一页问的是一个已经有答案的问题。
  IfFileExists "$LOCALAPPDATA\Ruyin\data\runtime\*.*" skipDataDirPage 0

  nsDialogs::Create 1018
  Pop $RuyinDataDirPage
  ${If} $RuyinDataDirPage == error
    Abort
  ${EndIf}

  ; 标题写在对话框里，**不用 `MUI_HEADER_TEXT`**：electron-builder 把自定义
  ; include 放在公共头部，那时 MUI2 还没被引进来，于是那个宏在这里根本不存在 ——
  ; CI 上报的就是这一行（`!include: error ... on line 63`）。本地探针脚本先引
  ; MUI2 再引本文件，所以没复现出来；探针现在按真实顺序来了。
  ${NSD_CreateLabel} 0 0 100% 12u "选择数据目录"
  Pop $0
  ${NSD_CreateLabel} 0 14u 100% 34u "RUYIN 的业务数据（项目库、产品库、密钥）会放在下面这个目录。数据整库加密，密钥按当前 Windows 用户封装 —— 所以请选一个只有你自己使用的位置，不要选可移动磁盘或共享目录。装好之后也可以在设置里改。"
  Pop $0

  ; 默认值必须**与应用真正用的位置一字不差**（apps/shell/src/main.ts 的
  ; `defaultDataDir`）：本地 AppData，不是漫游 —— 漫游目录在域环境里会随登录/
  ; 注销整份同步，而项目库是 GB 级的东西（owner 2026-09-05 定）。
  ;
  ; 两边写得不一致的后果 2026-09-04 已经撞过一次：页面上说数据去 Local、应用
  ; 实际去了 Roaming，而且用户**什么都不改**也会因为「与默认值不同」被写进一个
  ; 多余的指针。改这一行时，请连同 main.ts 那一处一起改。
  ${NSD_CreateDirRequest} 0 54u 75% 12u "$LOCALAPPDATA\Ruyin\data"
  Pop $RuyinDataDirField

  ${NSD_CreateButton} 80% 53u 20% 14u "浏览…"
  Pop $0
  ${NSD_OnClick} $0 RuyinBrowseDataDir

  nsDialogs::Show
  Return
  skipDataDirPage:
  ; 用 Abort 而不是直接返回：页面回调里 Abort 的含义正是「跳过这一页」，直接
  ; 返回会停在一张空白页上。
  Abort
FunctionEnd

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

!endif ; BUILD_UNINSTALLER
