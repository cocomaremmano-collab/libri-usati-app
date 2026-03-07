declare global {
  interface Window {
    cv: any;
  }
}

export const processImage = async (file: Blob): Promise<Blob> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      
      let finalCanvas = document.createElement('canvas');
      let ctx = finalCanvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      // --- Resize & Convert Logic ---
      let width = img.width;
      let height = img.height;
      
      // Calculate new dimensions (max 3840px on longest side - 4K QUALITY)
      const MAX_SIZE = 3840;
      if (width > height) {
        if (width > MAX_SIZE) {
          height = Math.round(height * (MAX_SIZE / width));
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width = Math.round(width * (MAX_SIZE / height));
          height = MAX_SIZE;
        }
      }
      
      finalCanvas.width = width;
      finalCanvas.height = height;
      
      // Draw image
      ctx.drawImage(img, 0, 0, width, height);
      
      // Convert to WebP
      finalCanvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert image to WebP'));
        }
      }, 'image/webp', 1.0); // Quality 1.0 (MAXIMUM)
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    
    img.src = url;
  });
};
