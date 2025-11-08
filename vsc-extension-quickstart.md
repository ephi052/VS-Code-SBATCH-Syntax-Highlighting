# Welcome to the SBATCH Syntax Highlighting Extension

## What's in the folder

* This folder contains all of the files necessary for your extension.
* `package.json` - manifest file declaring language support, commands, and grammar location.
* `syntaxes/sbatch.tmLanguage.json` - TextMate grammar file for tokenization with improved directive argument parsing.
* `language-configuration.json` - language configuration defining tokens for comments and brackets.
* `extension.js` - JavaScript runtime for commands (submit job, list jobs with webview).
* `images/` - icons and screenshots for the extension.

## Get up and running straight away

* Make sure the language configuration settings in `language-configuration.json` are accurate.
* Press `F5` to open a new window with your extension loaded.
* Create a new `.sbatch` file to test syntax highlighting.
* Verify that syntax highlighting works for `#SBATCH` directives, arguments, strings, and placeholders.
* Test the right-click context menu commands on `.sbatch` files.

## Make changes

* You can relaunch the extension from the debug toolbar after making changes to the files listed above.
* You can also reload (`Ctrl+R` or `Cmd+R` on Mac) the VS Code window with your extension to load your changes.

## Features

- **Syntax Highlighting**: Enhanced parsing of SLURM directives with argument, string, and placeholder support
- **Job Submission**: Right-click command to submit jobs via `sbatch`
- **Job Management**: Interactive webview to list active and historical jobs with ability to cancel active jobs

## Add more language features

* To add features such as IntelliSense, hovers and validators check out the VS Code extenders documentation at https://code.visualstudio.com/docs

## Install your extension

* To start using your extension with Visual Studio Code, run `npx vsce package` to create a `.vsix` file.
* Install via Extensions view > `...` > Install from VSIX.
* To share your extension with the world, read on https://code.visualstudio.com/docs about publishing an extension.
