declare global {
  interface Window {
    cv: any;
  }
}

export const processImage = async (file: Blob, autoStraighten: boolean = false, removeBackground: boolean = false): Promise<Blob> => {
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
      let mask: any = null;

      try {
        if (window.cv && window.cv.Mat) {
          const cv = window.cv;
          
          // Create source matrix from image
          srcMat = cv.imread(img);
          
          if (removeBackground) {
            // Convert to HSV for better color segmentation
            let hsv = new cv.Mat();
            cv.cvtColor(srcMat, hsv, cv.COLOR_RGBA2RGB); // Ensure RGB first
            cv.cvtColor(hsv, hsv, cv.COLOR_RGB2HSV);

            // Define Green Range (approximate for green screen)
            // H: 35-85, S: 50-255, V: 50-255
            let lowerGreen = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [35, 50, 50, 0]);
            let upperGreen = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [85, 255, 255, 255]);
            
            // Define Black Range (approximate for black screen)
            // H: 0-180, S: 0-255, V: 0-30 (Very dark)
            let lowerBlack = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [0, 0, 0, 0]);
            let upperBlack = new cv.Mat(hsv.rows, hsv.cols, hsv.type(), [180, 255, 40, 255]); // Increased V slightly

            let maskGreen = new cv.Mat();
            let maskBlack = new cv.Mat();
            
            cv.inRange(hsv, lowerGreen, upperGreen, maskGreen);
            cv.inRange(hsv, lowerBlack, upperBlack, maskBlack);
            
            // Combine masks
            mask = new cv.Mat();
            cv.bitwise_or(maskGreen, maskBlack, mask);
            
            // Invert mask (we want to KEEP the book, which is NOT green/black)
            cv.bitwise_not(mask, mask);
            
            // Apply mask to alpha channel
            let rgbaPlanes = new cv.MatVector();
            cv.split(srcMat, rgbaPlanes);
            
            // Set alpha channel based on mask
            // But first, let's clean up the mask with morphology
            let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
            cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
            cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel);
            
            // Update Alpha channel
            rgbaPlanes.set(3, mask);
            cv.merge(rgbaPlanes, srcMat);

            // Cleanup
            hsv.delete(); lowerGreen.delete(); upperGreen.delete();
            lowerBlack.delete(); upperBlack.delete();
            maskGreen.delete(); maskBlack.delete();
            rgbaPlanes.delete(); kernel.delete();
          }

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
              // No quad found, use original (potentially with background removed)
              let tempCanvas = document.createElement('canvas');
              cv.imshow(tempCanvas, srcMat);
              var sourceDrawable: any = tempCanvas;
              var sourceWidth = tempCanvas.width;
              var sourceHeight = tempCanvas.height;
            }
          } else {
            // Auto-straighten disabled but maybe background removed
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
        if (mask) mask.delete();
      }

      // --- Resize & Convert Logic ---
      let width = sourceWidth;
      let height = sourceHeight;
      
      // Calculate new dimensions (max 2560px on longest side - INCREASED QUALITY)
      const MAX_SIZE = 2560;
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
      }, 'image/webp', 0.95); // Quality 0.95 (INCREASED)
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    
    img.src = url;
  });
};
