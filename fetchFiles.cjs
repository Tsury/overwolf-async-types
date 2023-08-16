const axios = require('axios');
const fs = require('fs');
const path = require('path');

const owner = 'overwolf';
const repo = 'types';

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
                  fs.writeFileSync(path.join(dir, file.name), fileResponse.data);
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