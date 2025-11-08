# "SBATCH" only
#SBATCH
# With trailing space
#SBATCH   
# Missing argument
#SBATCH --
# Standard parameter + options
#SBATCH --job-name=my_job
# With spaces
#SBATCH --job-name = my_job
# Numeric value
#SBATCH --ntasks=4
# Numeric with trailing space
#SBATCH --nodes=4  
# Value with inline comment
#SBATCH --nodes=4  # Comment
# Time value
#SBATCH --time=01:00:00
# Parameter without a value or "="
#SBATCH --output
# Parameter without a value
#SBATCH --output=
# Path with leading slash
#SBATCH --output=/Filepath
# Quoted path with spaces
#SBATCH --error="/Filepath/with spaces"
# Quoted relative path
#SBATCH --error="filepath.err"
# Filepath with slurm variable substitution
#SBATCH --output=output%j.out
# Disabled
##SBATCH --Disabled command
