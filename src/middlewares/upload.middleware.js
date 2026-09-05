import multer from 'multer';
import { MAX_UPLOAD_BYTES } from '../constants.js';

// Files go to memory and straight into the SQLite blob store from there, so
// nothing is ever written to the application directory — which is what a deploy
// used to wipe.
const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    // One file per resource. Without this a client can post any number of parts
    // and multer buffers every one of them before the route ever runs.
    files: 1,
  },
});
