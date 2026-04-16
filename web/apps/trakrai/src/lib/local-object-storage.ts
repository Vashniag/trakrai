import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const getObjectStorageRoot = () => path.join(process.cwd(), '.local-object-storage');

const objectFilePath = (objectId: string, objectKey: string) => {
  const extension = path.extname(objectKey) || '.bin';
  return path.join(getObjectStorageRoot(), `${objectId}${extension}`);
};

const writeStoredObject = async (objectId: string, objectKey: string, data: Uint8Array) => {
  const root = getObjectStorageRoot();
  await mkdir(root, { recursive: true });
  const filePath = objectFilePath(objectId, objectKey);
  await writeFile(filePath, data);
  return filePath;
};

const readStoredObject = async (objectId: string, objectKey: string) => {
  const filePath = objectFilePath(objectId, objectKey);
  const data = await readFile(filePath);
  return {
    data,
    filePath,
  };
};

export { getObjectStorageRoot, readStoredObject, writeStoredObject };
