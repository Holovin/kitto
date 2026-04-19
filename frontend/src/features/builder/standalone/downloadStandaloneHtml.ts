export function downloadStandaloneHtml(html: string, filename: string) {
  const fileBlob = new Blob([html], {
    type: 'text/html;charset=utf-8',
  });
  const downloadUrl = URL.createObjectURL(fileBlob);
  const linkElement = document.createElement('a');

  linkElement.href = downloadUrl;
  linkElement.download = filename;
  linkElement.style.display = 'none';
  document.body.appendChild(linkElement);

  try {
    linkElement.click();
  } finally {
    linkElement.remove();
    URL.revokeObjectURL(downloadUrl);
  }
}
