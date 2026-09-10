const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
const indexHtml = path.join(__dirname, '..', 'web', 'dist', 'index.html');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: '门窗设计软件',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (fs.existsSync(indexHtml)) {
    win.loadFile(indexHtml);
  } else {
    win.loadURL(devUrl);
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});