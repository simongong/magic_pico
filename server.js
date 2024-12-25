const Koa = require('koa');
const Router = require('@koa/router');
const serve = require('koa-static');
const bodyParser = require('koa-bodyparser');
const multer = require('koa-multer');
const Tesseract = require('node-tesseract-ocr');
const Jimp = require('jimp');
const fs = require('fs/promises'); // Use fs.promises for async file operations
const path = require('path');

const app = new Koa();
const router = new Router();
const port = 3000;

app.use(bodyParser());

// Configure Multer
const storage = multer.diskStorage({
    destination: async (ctx, file, cb) => {
        try {
            await fs.mkdir('uploads', { recursive: true });
            cb(null, 'uploads/');
        } catch (err) {
            cb(err, null);
        }
    },
    filename: (ctx, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    },
});

const upload = multer({ storage });
app.use(upload.single('image')); // Parses multipart/form-data (file uploads)

app.use(serve(path.join(__dirname, 'public'))); // Important: Use path.join

router.post('/replaceText', async (ctx) => {
    try {
        console.log("Files:", ctx.request.files); // Log the files object
        console.log("Body:", ctx.request.body); // Log the body object
        if (!ctx.request.file) {
            ctx.status = 400;
            ctx.body = 'Missing image or text parameters.';
            return;
        }

        const imagePath = ctx.request.file.path;
        const oldText = ctx.request.body.oldText;
        const newText = ctx.request.body.newText;

        const options = {
            l: 'eng',
            psm: 6,
        };

        const ocrResult = await Tesseract.recognize(imagePath, options);

        // Find text location (same as before)
        const lines = ocrResult.lines;
        let textLocation = null;
        for (const line of lines) {
            for (const word of line.words) {
                if (word.text.includes(oldText)) {
                    textLocation = {
                        x: word.bbox.x0,
                        y: word.bbox.y0,
                        width: word.bbox.x1 - word.bbox.x0,
                        height: word.bbox.y1 - word.bbox.y0,
                    };
                    break;
                }
            }
            if (textLocation) break;
        }

        if (!textLocation) {
            await fs.unlink(imagePath);
            ctx.status = 404;
            ctx.body = 'Text not found in image.';
            return;
        }

        const image = await Jimp.read(imagePath);
        const font = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);

        image.print(font, textLocation.x, textLocation.y, {
            text: newText,
            alignmentX: Jimp.HORIZONTAL_ALIGN_LEFT,
            alignmentY: Jimp.VERTICAL_ALIGN_TOP
        }, textLocation.width, textLocation.height);

        const modifiedImagePath = 'modified-' + path.basename(imagePath);
        await image.writeAsync(modifiedImagePath);

        ctx.attachment(modifiedImagePath); // Set attachment header for download
        ctx.status = 200;
        ctx.body = fs.createReadStream(modifiedImagePath);

        ctx.res.on('finish', async () => {
            await fs.unlink(imagePath);
            await fs.unlink(modifiedImagePath);
        });
    } catch (error) {
        console.error(error);
        ctx.status = 500;
        ctx.body = 'Error processing image.';
    }
});

app.use(router.routes()).use(router.allowedMethods());

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});