# Changelog

All notable changes to this project will be documented in this file.

## [0.0.2] - 2025-11-08
### Added
- Language icon for `.sbatch` files without requiring an external icon theme. (Thanks @Antyos)

### Fixed
- Improved syntax highlighting of arguments, strings, numbers, and placeholders in SLURM directives. (Thanks @Antyos)
- Distinct highlighting for disabled `##SBATCH` lines across themes. (Thanks @Antyos)

### Removed
- Full icon theme contribution (HPC File Icons) - no longer needed since `.sbatch` files now have a built-in icon.

## [0.0.1] - 2024-11-02
### Added
- Initial release with syntax highlighting for `.sbatch` files.
- SLURM job submission command for `.sbatch` files.
- File Icon for `.sbatch` files.
- File Icons for most common file types used in HPC.
- Default Icon for unknown file types.
- Folder Icon for directories.
