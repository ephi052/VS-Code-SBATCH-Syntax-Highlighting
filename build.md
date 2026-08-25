# SBATCH Syntax Highlighting and SLURM Job Submission for VS Code - build instructions

This extension provides syntax highlighting and job submission features for `.sbatch` files used with SLURM job scheduling.

## Pre-requisites

- [Node.js](https://nodejs.org/en/download/) 18 or newer
- [VS Code](https://code.visualstudio.com/download)

## Build Instructions

1. Clone the repository.
2. Run `npm install` to install the dependencies.
3. Run `npm test` and `npm run lint` to run the checks.
4. Run `npm run package` to create the `.vsix` file (wraps `npx vsce package`).

## Installation

1. In VS Code, go to the Extensions view by clicking on the square icon in the sidebar.
2. Click on the three dots in the top right corner and select **Install from VSIX...**.
3. Select the `.vsix` file you created in the previous step.

## How to Use

1. Open any `.sbatch` file in VS Code to see syntax highlighting with proper argument and directive highlighting.
2. Right-click on the `.sbatch` file in the file explorer and select:
   - **Submit a SLURM Job from This File** to submit the job via `sbatch`
   - **List Submitted Jobs from This File** to view active and historical jobs from this script

## Testing on a remote host

If you develop on your laptop but SLURM lives on a login node, open this repository with the **Remote - SSH** extension and run the **Extension** launch config (F5) from the remote window. The Extension Development Host then runs on the remote machine, where `sbatch`/`squeue`/`sacct`/`scancel` are available.
