import { decodeQr, type ScanRequest, type ScanResponse } from "./decode";

self.onmessage = ({ data }: MessageEvent<ScanRequest>) => {
  let response: ScanResponse;
  try {
    response = { id: data.id, result: decodeQr(data.image) };
  } catch {
    response = { id: data.id, result: null, error: "识别失败，请换一张清晰的图片再试" };
  }
  self.postMessage(response);
};
