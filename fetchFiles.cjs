const axios = require('axios');
const fs = require('fs');
const path = require('path');
const Diff = require('diff');

const owner = 'overwolf';
const repo = 'types';

// Function to fetch PR diff from GitHub and apply as a patch
async function applyPrDiff(filePath, prUrl) {
  try {
    const diffUrl = `${prUrl}.diff`;
    const response = await axios.get(diffUrl);
    const patchContent = response.data;

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const patchedContent = Diff.applyPatch(fileContent, patchContent);

    if (patchedContent === false) {
      console.error(`Error applying PR ${prUrl} to ${filePath}: Patch application failed.`);
    } else {
      fs.writeFileSync(filePath, patchedContent);
      console.log(`Applied PR ${prUrl} to ${filePath} successfully.`);
    }
  } catch (error) {
    console.error(`Failed to fetch PR diff from ${prUrl}:`, error);
  }
}

// Function to read PR URLs from a patch file if it exists
function applyPatchesFromPrFile(filePath) {
  const patchFile = path.join(__dirname, 'patches', path.basename(filePath));

  // Check if the patch file exists
  if (fs.existsSync(patchFile)) {
    fs.readFile(patchFile, 'utf-8', (err, data) => {
      if (err) {
        console.error(`Failed to read patch file ${patchFile}:`, err);
        return;
      }

      // Each line in the file is a URL to a PR
      const prUrls = data.split('\n').map(line => line.trim()).filter(Boolean);
      prUrls.forEach(prUrl => applyPrDiff(filePath, prUrl));
    });
  }
}

// Function to fetch files from the GitHub repository
function fetchFiles(url, dir) {
  axios.get(url)
    .then(response => {
      response.data.forEach(file => {
        if (file.type === 'dir') {
          fetchFiles(file.url, path.join(dir, file.name));
        } else if (file.name.endsWith('.d.ts')) {
          axios.get(file.download_url)
            .then(fileResponse => {
              fs.promises.mkdir(dir, { recursive: true })
                .then(() => {
                  const filePath = path.join(dir, file.name);
                  fs.writeFileSync(filePath, fileResponse.data);

                  // Apply patches from PR file if it exists
                  applyPatchesFromPrFile(filePath);
                });
            });
        }
      });
    })
    .catch(error => {
      console.error(error);
    });
}

const url = `https://api.github.com/repos/${owner}/${repo}/contents`;
const dir = path.join(__dirname, repo);

fetchFiles(url, dir);
