/**
 * Blok media di dalam gelembung Live Chat: audio, dokumen, video, kontak,
 * gambar, dan lokasi. Presentasi murni; data sudah diekstrak halaman induk.
 */
import React from 'react';
import { Download, ExternalLink, FileText, MapPin, User } from 'lucide-react';
import { MediaImage, ChatMediaData } from '../common/MediaImage';
import { VoiceNotePlayer } from '../common/VoiceNotePlayer';
import { extractImageCaption } from '../../utils/mediaExtractor';
import type {
  ChatAudioData,
  ChatContactData,
  ChatDocumentData,
  ChatLocationData,
  ChatVideoData,
} from '../../utils/mediaExtractor';
import { getGoogleMapsDirectionUrl } from '../../utils/geoUtils';

interface LiveChatMessageMediaProps {
  content: string;
  media: ChatMediaData | null | undefined;
  audioData: ChatAudioData | null;
  docData: ChatDocumentData | null;
  videoData: ChatVideoData | null;
  contactData: ChatContactData | null;
  locData: ChatLocationData | null;
  hasMediaOnly: boolean;
  renderCaption: (text: string) => React.ReactNode;
}

export const LiveChatMessageMedia: React.FC<LiveChatMessageMediaProps> = ({
  content,
  media,
  audioData,
  docData,
  videoData,
  contactData,
  locData,
  hasMediaOnly,
  renderCaption,
}) => (
  <>
  {/* 1. Audio / PTT Voice Note */}
  {audioData && audioData.url && (
    <div className="mb-1.5">
      <VoiceNotePlayer src={audioData.url} />
    </div>
  )}

  {/* 2. Document / PDF */}
  {docData && docData.url && (
    <div className="mb-1.5">
      <a
        href={docData.url}
        target="_blank"
        rel="noopener noreferrer"
        download
        className="flex items-center gap-2.5 p-2.5 rounded-xl bg-fill-1 border border-divider hover:bg-accent-soft transition text-left max-w-[260px]"
      >
        <span className="w-8 h-8 rounded-lg bg-info-soft text-info flex items-center justify-center shrink-0">
          <FileText size={16} />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-xs font-bold text-ink truncate">
            {String(docData.fileName || 'Dokumen').slice(0, 48)}
          </span>
          <span className="block text-[10px] text-ink-2">
            {docData.fileSize ? `${Math.round(Number(docData.fileSize) / 1024)} KB • Ketuk untuk unduh` : 'Ketuk untuk unduh'}
          </span>
        </span>
        <Download size={14} className="text-ink-3 shrink-0" />
      </a>
    </div>
  )}

  {/* 3. Video */}
  {videoData && videoData.url && (
    <div className="mb-1.5 max-w-[280px]">
      <video
        src={videoData.url}
        controls
        className="rounded-lg max-h-[240px] w-full bg-black"
      />
      {videoData.caption && (
        <span className="block mt-1 text-[11px] text-ink break-words">
          {renderCaption(videoData.caption)}
        </span>
      )}
    </div>
  )}

  {/* 4. Contact vCard */}
  {contactData && (
    <div className="my-1 p-2 bg-fill-1 hover:bg-accent-soft rounded-xl border border-divider transition flex items-center space-x-2.5 text-left max-w-[260px]">
      <div className="w-8 h-8 rounded-lg bg-success-soft text-success flex items-center justify-center shrink-0">
        <User size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-[12px] text-ink leading-tight truncate">
          {contactData.displayName || 'Kontak WhatsApp'}
        </p>
        {contactData.phoneNumber && (
          <p className="text-[11px] text-ink-2 font-mono truncate mt-0.5">
            {contactData.phoneNumber}
          </p>
        )}
      </div>
      {contactData.phoneNumber && (
        <a
          href={`tel:${contactData.phoneNumber}`}
          className="px-2 py-1 bg-accent hover:bg-accent-hover text-on-solid rounded-lg text-[10px] font-bold transition shrink-0"
          title="Hubungi kontak"
        >
          Telepon
        </a>
      )}
    </div>
  )}

  {/* 5. Image / Photo */}
   {!!media && !audioData && !docData && !videoData && (
     <div className={hasMediaOnly ? 'mb-0.5' : 'mb-1.5'}>
       <MediaImage
         src={media!.url || media!.hdUrl || media!.thumbUrl}
         downloadSrc={media!.hdUrl || media!.url}
         thumbUrl={media!.thumbUrl}
         caption={media!.caption || extractImageCaption(content) || undefined}
       />
     </div>
   )}

  {/* 6. Location (Pin GPS & Live Location) */}
  {locData && (
    <div className="my-1 p-2 bg-fill-1 hover:bg-accent-soft rounded-xl border border-divider transition flex items-center space-x-2.5 text-left">
      <div className="w-8 h-8 rounded-lg bg-danger-soft text-danger flex items-center justify-center shrink-0">
        <MapPin size={17} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-[12px] text-ink leading-tight flex items-center gap-1">
          <span>{locData.isLive ? 'Live Location WhatsApp' : 'Lokasi Pin WhatsApp'}</span>
          {locData.isLive && <span className="inline-block w-2 h-2 rounded-full bg-danger" />}
        </p>
        <p className="text-[10px] text-ink-2 font-mono truncate mt-0.5">
          {locData.latitude}, {locData.longitude}
        </p>
        {(locData.name || locData.address) && (
          <p className="text-[11px] text-ink truncate mt-0.5 font-medium">
            {locData.name || locData.address}
          </p>
        )}
      </div>
      <a
        href={locData.url || getGoogleMapsDirectionUrl(locData.latitude, locData.longitude, locData.name || locData.address || null, 'gps_pin')}
        target="_blank"
        rel="noopener noreferrer"
        className="px-2.5 py-1.5 bg-accent hover:bg-accent-hover text-on-solid rounded-lg text-[11px] font-bold transition shadow-xs flex items-center space-x-1 shrink-0 active:scale-95"
        title="Buka lokasi di Google Maps"
      >
        <span>Peta</span>
        <ExternalLink size={12} />
      </a>
    </div>
  )}
  </>
);
