declare module 'cors';
declare module 'multer';

declare namespace Express {
  interface Request {
    file?: {
      path: string;
      originalname: string;
    };
  }
}
