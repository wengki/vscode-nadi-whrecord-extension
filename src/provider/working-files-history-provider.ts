import * as path from 'path';
import * as vscode from "vscode";
import { getNonce } from "../getNonce";
import { config } from "../lib/global/config";
import { WorkingHistoryFiles } from "../service/working-history-files";

export class WorkingFilesHistoryTab {
  /**
   * Track the currently panel. Only allow a single panel to exist at a time.
   */
  public static currentPanel: WorkingFilesHistoryTab | undefined;

  public static readonly viewType = "nadi-web-admin";

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public workingHistoryFiles = new WorkingHistoryFiles();

  private targetFolder: string | undefined;

  public static createOrShow(extensionUri: vscode.Uri, targetFolder: string | undefined) {
    
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it.
    if (WorkingFilesHistoryTab.currentPanel) {
      WorkingFilesHistoryTab.currentPanel._panel.reveal(column);
      WorkingFilesHistoryTab.currentPanel._update();
      return;
    }

    // Otherwise, create a new panel.
    const panel = vscode.window.createWebviewPanel(
      WorkingFilesHistoryTab.viewType,
      "Working History",
      column || vscode.ViewColumn.One,
      {
        // Enable javascript in the webview
        enableScripts: true,

        // And restrict the webview to only loading content from our extension's `media` directory.
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, "media"),
          vscode.Uri.joinPath(extensionUri, "out/compiled"),
        ],
      }
    );

    WorkingFilesHistoryTab.currentPanel = new WorkingFilesHistoryTab(panel, extensionUri, targetFolder);
  }

  public static kill() {
    WorkingFilesHistoryTab.currentPanel?.dispose();
    WorkingFilesHistoryTab.currentPanel = undefined;
  }

  public static revive(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    WorkingFilesHistoryTab.currentPanel = new WorkingFilesHistoryTab(panel, extensionUri);
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, targetFolder?: string | undefined) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    
    if(targetFolder !== undefined) {
      this.targetFolder = targetFolder;
    }

    // Set the webview's initial html content
    this._update();

    // Listen for when the panel is disposed
    // This happens when the user closes the panel or when the panel is closed programatically
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.type) {
          case "alert":
            vscode.window.showErrorMessage(message.text);
            return;
          case "getHistoryCollections": {
            if (!message.value) {
              return;
            }
            const histCol = this.workingHistoryFiles.readHistoryCollections(message.value);
            // console.log(data.value);
            this._panel.webview.postMessage({
              type: 'receiveHistoryCollections',
              value: histCol
            });
            break;
          }
          case "seeHistoryFileDiff": 
            this.workingHistoryFiles.takeHistoryDiff(message.value);
          break;
        }
      },
      null,
      this._disposables
    );
  }

  public dispose() {
    console.log('NADI History tab closed')
    WorkingFilesHistoryTab.currentPanel = undefined;

    // Clean up our resources
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private async _update() {
    const webview = this._panel.webview;

    this._panel.webview.html = this._getHtmlForWebview(webview);
    webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case "onInfo": {
          if (!data.value) {
            return;
          }
          vscode.window.showInformationMessage(data.value);
          break;
        }
        case "onError": {
          if (!data.value) {
            return;
          }
          vscode.window.showErrorMessage(data.value);
          break;
        }
      }
    });
  }

  _getHistoryList(){
    if(this.targetFolder !== undefined){
      return this.workingHistoryFiles.readHistoryCollections(path.join(config.localDirectory,'history', this.targetFolder));
    } else {
      return this.workingHistoryFiles.readHistoryFolder();
    }
  }

  _getTargetFolderData() {
    if(this.targetFolder !== undefined){
      return {
        date: this.workingHistoryFiles.convertTimeToDate(this.targetFolder),
        key: this.targetFolder
      }
    } else {
      return {}
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {

    const styleResetPath = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "reset.css"));
    const stylesPathMainPath = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "vscode.css"));
    const stylesPathNadiCss = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media", "nadi-extension.css"));
    const scriptMn = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "out/compiled", "WorkingFilesHistoryTab.js"));

    // Use a nonce to only allow specific scripts to be run
    const nonce = getNonce();

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
        -->
        <meta http-equiv="Content-Security-Policy" content="img-src https: data:; style-src 'unsafe-inline' ${webview.cspSource
      }; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleResetPath}" rel="stylesheet">
        <link href="${stylesPathMainPath}" rel="stylesheet">
        <link href="${stylesPathNadiCss}" rel="stylesheet">
        <script nonce="${nonce}">
            const nadivscode = acquireVsCodeApi();
            const workFilesHistory = ${JSON.stringify(this._getHistoryList())};
            const targetFolderData = ${JSON.stringify(this._getTargetFolderData())}
        </script>
			</head>
      <body>
      </body>
      <script src="${scriptMn}" nonce="${nonce}"></script>
	</html>`;
  }
}