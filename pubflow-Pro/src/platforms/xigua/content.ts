import { fillField, humanDelay } from '../../content/fieldFiller';
import { uploadCoverIfAvailable, uploadVideoIfAvailable } from '../../content/videoUploader';
import { composePublishMessage, waitForEditorReady } from '../../content/publishSteps';
import type { ContentData } from '../../types';
import type { PlatformConfig } from '../types';

/** 填充西瓜视频发布内容（标题、描述、封面、视频）。 */
export async function fillXiguaContent(config: PlatformConfig, content: ContentData) {
  let uploadMessage = '';
  if (content.videoCacheId) {
    uploadMessage = await uploadVideoIfAvailable(config, content);
    await humanDelay();
  }

  await waitForEditorReady(config);

  if (config.fields.title && content.title) {
    await fillField(config.fields.title, content.title);
    await humanDelay();
  }

  if (config.fields.description && content.description) {
    await fillField(config.fields.description, content.description);
    await humanDelay();
  }

  const coverMessage = await uploadCoverIfAvailable(config, content);
  if (coverMessage) {
    await humanDelay();
  }

  return composePublishMessage(uploadMessage, coverMessage);
}
