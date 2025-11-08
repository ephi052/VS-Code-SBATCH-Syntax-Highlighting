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

#!/bin/bash
#SBATCH --time=0-00:05:00

# Define the partition on which the job shall run. May be omitted.
#SBATCH --partition normal

# How much memory you need.
# --mem will define memory per node and
# --mem-per-cpu will define memory per CPU/core. Choose one of those.
##SBATCH --mem-per-cpu=1500MB
#SBATCH --mem=5GB    # this one is not in effect, due to the double hash

# Turn on mail notification. There are many possible self-explaining values:
# NONE, BEGIN, END, FAIL, ALL (including all aforementioned)
# For more values, check "man sbatch"
#SBATCH --mail-type=END,FAIL

# You may not place any commands before the last SBATCH directive

# Define and create a unique scratch directory for this job
SCRATCH_DIRECTORY=/global/work/${USER}/${SLURM_JOBID}.stallo-adm.uit.no
mkdir -p ${SCRATCH_DIRECTORY}
cd ${SCRATCH_DIRECTORY}

# You can copy everything you need to the scratch directory
# ${SLURM_SUBMIT_DIR} points to the path where this script was submitted from
cp ${SLURM_SUBMIT_DIR}/myfiles*.txt ${SCRATCH_DIRECTORY}

# This is where the actual work is done. In this case, the script only waits.
# The time command is optional, but it may give you a hint on how long the
# command worked
time sleep 10
#sleep 10

# After the job is done we copy our output back to $SLURM_SUBMIT_DIR
cp ${SCRATCH_DIRECTORY}/my_output ${SLURM_SUBMIT_DIR}

# In addition to the copied files, you will also find a file called

