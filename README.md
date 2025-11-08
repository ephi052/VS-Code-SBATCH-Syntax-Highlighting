# SBATCH Syntax Highlighting and SLURM Job Submission for VS Code


This extension provides syntax highlighting and job submission features for `.sbatch` files used with SLURM job scheduling.

## Features

- Syntax highlighting for `.sbatch` files, including differentiation between active `#SBATCH` commands and commented `##SBATCH` lines.
- Right-click on `.sbatch` files to submit a SLURM job directly from VS Code.
- Right-click on `.sbatch` files to list all jobs (active and historical) submitted from that file.
- File icon for `.sbatch` files for easy identification.

## Installation
- Install the extension from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=EphiCohen.sbatch).


## How to Use

1. Open any `.sbatch` file in VS Code to see syntax highlighting.
2. Right-click on the `.sbatch` file in the file explorer and select:
   - **Submit a SLURM Job from This File** to submit the job
   - **List Submitted Jobs from This File** to view active and historical jobs from this script

### Syntax Highlighting

![Syntax Highlighting](https://github.com/ephi052/VS-Code-SBATCH-Syntax-Highlighting/blob/main/images/syntax-highlighting.png)

- Active `#SBATCH` commands are highlighted in **purple**.
- Commented `##SBATCH` lines are highlighted in **blue**.
- General comments are highlighted in **green**.
- The rest of the text follows standard **bash** syntax colors.

### Job Management

![List Jobs](https://github.com/ephi052/VS-Code-SBATCH-Syntax-Highlighting/blob/main/images/list-jobs.png)

View all SLURM jobs (active and historical) submitted from a specific `.sbatch` file. Click on active job rows to cancel them with `scancel`.

## Requirements

Make sure `sbatch` and `squeue` (SLURM commands) are available in your system's PATH.

## Release Notes

For build instructions, see [build.md](./build.md)
For the license, see [LICENSE](./LICENSE.md)

See [CHANGELOG.md](./CHANGELOG.md) for detailed version history.

### 0.0.2
- Improved syntax highlighting for SLURM directives with better argument parsing
- Added language icon for `.sbatch` files
- New command to list active jobs submitted from a specific file
- Removed full icon theme (now using built-in language icon)

### 0.0.1
- Initial release with syntax highlighting and SLURM job submission command.

---

For more information, visit [our repository](https://github.com/ephi052/VS-Code-SBATCH-Syntax-Highlighting).

![Icon](https://github.com/ephi052/VS-Code-SBATCH-Syntax-Highlighting/blob/main/icon.png)