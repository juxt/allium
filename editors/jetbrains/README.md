# JetBrains integration

Validate `.allium` files on save using the built-in File Watchers plugin.

## Prerequisites

- The `allium` CLI on your PATH
- The File Watchers plugin enabled (bundled with IntelliJ IDEA, WebStorm, PyCharm, CLion, and others)

## Setup

1. Open **Settings > Tools > File Watchers**
2. Click the **Import** button (arrow icon in the toolbar)
3. Select `watchers.xml` from this directory
4. Click **OK**

The watcher runs `allium check` on every `.allium` file when it changes. Errors appear in the IDE's console and are highlighted by the "File Watcher problems" inspection.

## Manual setup

If you prefer to configure it by hand:

1. Open **Settings > Tools > File Watchers**
2. Click **+** and choose **Custom**
3. Set **File type** to your registered type for `.allium` files (or create one under **Settings > Editor > File Types**)
4. Set **Program** to `allium`
5. Set **Arguments** to `check $FilePath$`
6. Set **Working directory** to `$ProjectFileDir$`
7. Uncheck **Auto-save edited files to trigger the watcher** if you only want it to run on explicit save
