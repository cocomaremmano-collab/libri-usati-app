import express from "express";
import { createServer as createViteServer } from "vite";
import { S3Client, ListObjectsV2Command, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Hardcoded credentials (WARNING: Exposed in server-side code)
// In a real production app, these should be environment variables.
const KEY_ID = '0038671d8c7ead60000000001';
const APP_KEY = 'K003HSlr0zaR+4S3QGpHdRikJ37gCYs';
const BUCKET_NAME = 'libri-usati-catalog';
const REGION = 'eu-central-003';
const ENDPOINT = `https://s3.${REGION}.backblazeb2.com`;

const s3Client = new S3Client({
  endpoint: ENDPOINT,
  region: REGION,
  credentials: {
    accessKeyId: KEY_ID,
    secretAccessKey: APP_KEY
  },
  forcePathStyle: true
});

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Request logging middleware
  app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
      console.log(`[API] ${req.method} ${req.path}`);
    }
    next();
  });

  // API Routes
  app.get("/api/b2/list", async (req, res) => {
    try {
      const prefix = req.query.prefix as string || '';
      const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
        Prefix: prefix,
        Delimiter: '/'
      });

      const response = await s3Client.send(command);
      
      const folders = (response.CommonPrefixes || []).map(p => ({
        id: p.Prefix!,
        name: p.Prefix!.replace(prefix, '').replace(/\/$/, ''),
        fullName: p.Prefix!,
        isFolder: true,
        mimeType: 'application/x-directory',
        thumbnailLink: null,
        webViewLink: null
      }));

      const files = await Promise.all((response.Contents || []).map(async f => {
        const isDir = f.Key!.endsWith('/');
        const isImage = f.Key!.endsWith('.webp') || f.Key!.endsWith('.jpg') || f.Key!.endsWith('.png') || f.Key!.endsWith('.jpeg');
        
        let signedUrl = null;
        if (!isDir && isImage) {
          const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: f.Key! });
          // Generate a signed URL valid for 1 hour (3600 seconds)
          signedUrl = await getSignedUrl(s3Client, getCmd, { expiresIn: 3600 });
        }

        return {
          id: f.Key!,
          name: f.Key!.replace(prefix, '').replace(/^\//, ''),
          fullName: f.Key!,
          isFolder: false,
          mimeType: isDir ? 'application/x-directory' : 'application/octet-stream',
          thumbnailLink: signedUrl,
          webViewLink: signedUrl || `${ENDPOINT}/${BUCKET_NAME}/${f.Key}`,
          lastModified: f.LastModified
        };
      }));

      const filteredFiles = files.filter(f => f.name !== '.bzEmpty' && !f.name.endsWith('/'));

      res.json([...folders, ...filteredFiles]);
    } catch (error: any) {
      console.error("S3 List Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/b2/upload", upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileName = req.body.fileName;
      const contentType = req.body.contentType || req.file.mimetype;

      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileName,
        Body: req.file.buffer,
        ContentType: contentType
      });

      await s3Client.send(command);
      res.json({ fileName });
    } catch (error: any) {
      console.error("S3 Upload Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/b2/create-folder", async (req, res) => {
    try {
      const folderPath = req.body.folderPath;
      const fileName = folderPath.endsWith('/') ? `${folderPath}.bzEmpty` : `${folderPath}/.bzEmpty`;
      
      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileName,
        Body: Buffer.from(''),
        ContentType: 'application/x-directory'
      });

      await s3Client.send(command);
      res.json({ fileName });
    } catch (error: any) {
      console.error("S3 Create Folder Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/b2/delete", async (req, res) => {
    try {
      const fileName = req.body.fileName;
      
      const command = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: fileName
      });

      await s3Client.send(command);
      res.json({ fileName });
    } catch (error: any) {
      console.error("S3 Delete Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API 404 Handler - MUST be before Vite middleware
app.use("/api", (req, res) => {
    console.log(`[API] 404 Not Found: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files from dist in production
    app.use(express.static(path.join(__dirname, "dist")));

    // Handle SPA routing - send index.html for any other request
app.get("/:path(.*)", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
