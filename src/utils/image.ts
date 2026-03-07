declare global {
  interface Window {
    cv: any;
  }
}

export const processImage = async (file: Blob, autoStraighten: boolean = false): Promise<Blob> => {
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

      // --- Auto-Straighten Logic ---
      let srcMat: any = null;
      let dstMat: any = null;
      let contours: any = null;
      let hierarchy: any = null;
      let approx: any = null;
      let M: any = null;

      try {
        if (window.cv && window.cv.Mat) {
          const cv = window.cv;
          
          // Create source matrix from image
          srcMat = cv.imread(img);
          
          if (autoStraighten) {
             // Preprocessing for contour detection
            let gray = new cv.Mat();
            cv.cvtColor(srcMat, gray, cv.COLOR_RGBA2GRAY, 0);
            
            let blurred = new cv.Mat();
            cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
            
            let edges = new cv.Mat();
            cv.Canny(blurred, edges, 75, 200);
            
            // Find contours
            contours = new cv.MatVector();
            hierarchy = new cv.Mat();
            cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
            
            // Find largest quadrilateral
            let maxArea = 0;
            let maxContourIndex = -1;
            let foundQuad = false;
            
            for (let i = 0; i < contours.size(); ++i) {
              let cnt = contours.get(i);
              let area = cv.contourArea(cnt);
              
              // Filter small contours (must be at least 20% of image area)
              if (area < (srcMat.cols * srcMat.rows * 0.2)) continue;
              
              let peri = cv.arcLength(cnt, true);
              approx = new cv.Mat();
              cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
              
              if (approx.rows === 4 && area > maxArea) {
                maxArea = area;
                maxContourIndex = i;
                foundQuad = true;
                // Keep approx for later use
              } else {
                approx.delete(); // Clean up if not used
              }
            }
            
            // Clean up intermediate mats
            gray.delete();
            blurred.delete();
            edges.delete();

            if (foundQuad && maxContourIndex !== -1) {
              // Re-approximate the best contour to get the 4 points
              let cnt = contours.get(maxContourIndex);
              let peri = cv.arcLength(cnt, true);
              approx = new cv.Mat();
              cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
              
              // Sort corners: TL, TR, BR, BL
              // approx data is [x1, y1, x2, y2, x3, y3, x4, y4] (int32)
              // We need to extract points
              let points = [];
              for (let i = 0; i < 4; i++) {
                points.push({
                  x: approx.data32S[i * 2],
                  y: approx.data32S[i * 2 + 1]
                });
              }
              
              // Sort by Y to separate top/bottom
              points.sort((a, b) => a.y - b.y);
              
              // Top two points: sort by X (TL, TR)
              let top = points.slice(0, 2).sort((a, b) => a.x - b.x);
              let tl = top[0];
              let tr = top[1];
              
              // Bottom two points: sort by X (BL, BR)
              let bottom = points.slice(2, 4).sort((a, b) => a.x - b.x);
              let bl = bottom[0];
              let br = bottom[1];
              
              // Calculate width and height of new image
              let widthA = Math.sqrt(Math.pow(br.x - bl.x, 2) + Math.pow(br.y - bl.y, 2));
              let widthB = Math.sqrt(Math.pow(tr.x - tl.x, 2) + Math.pow(tr.y - tl.y, 2));
              let maxWidth = Math.max(Math.floor(widthA), Math.floor(widthB));
              
              let heightA = Math.sqrt(Math.pow(tr.x - br.x, 2) + Math.pow(tr.y - br.y, 2));
              let heightB = Math.sqrt(Math.pow(tl.x - bl.x, 2) + Math.pow(tl.y - bl.y, 2));
              let maxHeight = Math.max(Math.floor(heightA), Math.floor(heightB));
              
              // Source points
              let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                tl.x, tl.y,
                tr.x, tr.y,
                br.x, br.y,
                bl.x, bl.y
              ]);
              
              // Destination points
              let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
                0, 0,
                maxWidth, 0,
                maxWidth, maxHeight,
                0, maxHeight
              ]);
              
              // Warp perspective
              M = cv.getPerspectiveTransform(srcTri, dstTri);
              dstMat = new cv.Mat();
              cv.warpPerspective(srcMat, dstMat, M, new cv.Size(maxWidth, maxHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
              
              let tempCanvas = document.createElement('canvas');
              cv.imshow(tempCanvas, dstMat);
              
              // Update width/height for next steps
              img.width = tempCanvas.width;
              img.height = tempCanvas.height;
              
              // Clean up OpenCV objects
              srcTri.delete();
              dstTri.delete();
              
              var sourceDrawable = tempCanvas;
              var sourceWidth = tempCanvas.width;
              var sourceHeight = tempCanvas.height;
            } else {
              // No quad found, use original
              let tempCanvas = document.createElement('canvas');
              cv.imshow(tempCanvas, srcMat);
              var sourceDrawable: any = tempCanvas;
              var sourceWidth = tempCanvas.width;
              var sourceHeight = tempCanvas.height;
            }
          } else {
            // Auto-straighten disabled
            let tempCanvas = document.createElement('canvas');
            cv.imshow(tempCanvas, srcMat);
            var sourceDrawable: any = tempCanvas;
            var sourceWidth = tempCanvas.width;
            var sourceHeight = tempCanvas.height;
          }
        } else {
          // CV not loaded
          var sourceDrawable: any = img;
          var sourceWidth = img.width;
          var sourceHeight = img.height;
        }
      } catch (e) {
        console.error("OpenCV Error:", e);
        // Fallback to original image
        var sourceDrawable: any = img;
        var sourceWidth = img.width;
        var sourceHeight = img.height;
      } finally {
        // Clean up
        if (srcMat) srcMat.delete();
        if (dstMat) dstMat.delete();
        if (contours) contours.delete();
        if (hierarchy) hierarchy.delete();
        if (approx) approx.delete();
        if (M) M.delete();
      }

      // --- Resize & Convert Logic ---
      let width = sourceWidth;
      let height = sourceHeight;
      
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
      
      // Draw image (or temp canvas from CV)
      ctx.drawImage(sourceDrawable, 0, 0, width, height);
      
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
