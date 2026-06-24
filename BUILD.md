# 打包说明

## 打包命令

### 1. 打包成便携版 exe（推荐，单文件可直接运行）

```powershell
npm run build:portable
```

生成文件：`dist/每周待办-1.0.0-便携版.exe`
- 单个 exe 文件，无需安装，双击即可运行
- 适合放在桌面或U盘使用

### 2. 打包成安装包（带安装向导）

```powershell
npm run build:nsis
```

生成文件：`dist/每周待办-1.0.0-x64.exe`
- 带安装向导的安装程序
- 可选择安装路径
- 自动创建桌面快捷方式和开始菜单

### 3. 打包所有格式

```powershell
npm run build
```

同时生成便携版和安装包

### 4. 仅打包不压缩（用于测试）

```powershell
npm run pack
```

生成目录：`dist/win-unpacked/`
- 包含可直接运行的程序
- 用于测试打包结果

## 打包前准备

### 设置镜像源（解决下载慢的问题）

```powershell
# 设置 npm 镜像
npm config set registry https://registry.npmmirror.com

# 设置环境变量
$env:ELECTRON_MIRROR = "https://cdn.npmmirror.com/binaries/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
```

### 完整打包流程

```powershell
# 1. 进入项目目录
cd G:\AI\Workspaces\Trae\ToDoList

# 2. 设置镜像源
$env:ELECTRON_MIRROR = "https://cdn.npmmirror.com/binaries/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"

# 3. 安装依赖
npm install

# 4. 打包便携版
npm run build:portable
```

## 输出位置

所有打包文件都在 `dist` 目录中：
- `dist/每周待办-1.0.0-便携版.exe` - 便携版
- `dist/每周待办-1.0.0-x64.exe` - 安装包
- `dist/win-unpacked/` - 解压版目录

## 常见问题

### Q: 打包失败提示下载 electron 失败？
A: 设置环境变量后重试：
```powershell
$env:ELECTRON_MIRROR = "https://cdn.npmmirror.com/binaries/electron/"
```

### Q: 打包失败提示下载 nsis 失败？
A: 设置环境变量后重试：
```powershell
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
```

### Q: 如何添加应用图标？
A: 将 `icon.ico` 文件放在项目根目录，然后在 package.json 的 build.win 中添加：
```json
"icon": "icon.ico"
```
