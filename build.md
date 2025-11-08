# SBATCH Syntax Highlighting and SLURM Job Submission for VS Code - build instructions

This extension provides syntax highlighting and job submission features for `.sbatch` files used with SLURM job scheduling.

## Pre-requisites

- [Node.js](https://nodejs.org/en/download/)
- [VS Code](https://code.visualstudio.com/download)

## Build Instructions

1. Clone the repository.
2. Run `npm install` to install the dependencies.
3. Run `npx vsce package` to create the `.vsix` file (or install `vsce` globally with `npm install -g @vscode/vsce`).

## Installation

1. In VS Code, go to the Extensions view by clicking on the square icon in the sidebar.
2. Click on the three dots in the top right corner and select **Install from VSIX...**.
3. Select the `.vsix` file you created in the previous step.

## How to Use

1. Open any `.sbatch` file in VS Code to see syntax highlighting with proper argument and directive highlighting.
2. Right-click on the `.sbatch` file in the file explorer and select:
   - **Submit a SLURM Job from This File** to submit the job via `sbatch`
   - **List Submitted Jobs from This File** to view active and historical jobs from this script
