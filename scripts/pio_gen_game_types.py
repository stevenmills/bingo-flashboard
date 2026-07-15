Import("env")

import os
import subprocess

project_dir = env["PROJECT_DIR"]
script = os.path.join(project_dir, "scripts", "generate-game-types.mjs")

print("Generating game type catalog...")
result = subprocess.run(["node", script], cwd=project_dir)
if result.returncode != 0:
    env.Exit(f"generate-game-types.mjs failed with code {result.returncode}")
