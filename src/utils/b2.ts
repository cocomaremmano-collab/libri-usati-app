export const b2ListFiles = async (prefix: string = '') => {
  const response = await fetch(`/api/b2/list?prefix=${encodeURIComponent(prefix)}`);
  if (!response.ok) {
    let errorMessage = 'Failed to list files';
    try {
      const error = await response.json();
      errorMessage = error.error || errorMessage;
    } catch (e) {
      const text = await response.text();
      errorMessage = `Server Error (${response.status}): ${text.substring(0, 100)}`;
    }
    throw new Error(errorMessage);
  }
  try {
    return await response.json();
  } catch (e) {
    const text = await response.text();
    throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
  }
};

export const b2UploadFile = async (file: Blob, fileName: string, contentType: string) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('fileName', fileName);
  formData.append('contentType', contentType);

  const response = await fetch('/api/b2/upload', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to upload file');
  }
  return await response.json();
};

export const b2DeleteFile = async (fileName: string, fileId?: string) => {
  const response = await fetch('/api/b2/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fileName })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete file');
  }
  return await response.json();
};

export const b2CreateFolder = async (folderPath: string) => {
  const response = await fetch('/api/b2/create-folder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ folderPath })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create folder');
  }
  return await response.json();
};

export const b2DeleteFolder = async (folderPath: string) => {
  const response = await fetch('/api/b2/delete-folder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ folderPath })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete folder');
  }
  return await response.json();
};

