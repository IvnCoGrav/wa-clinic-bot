/** Pesan chat yang ditampilkan di panel staf. Bentuknya mengikuti payload server. */
import { ChatMediaData } from '../../components/common/MediaImage';

export interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  sender_type?: string | null;
  sender_name?: string | null;
  created_at: string;
  media?: ChatMediaData;
  delivery_status?: 'sent' | 'delivered' | 'read' | 'failed' | null;
  delivered_at?: string | null;
  read_at?: string | null;
  is_revoked?: boolean;
  is_edited?: boolean;
  quoted_message?: {
    id?: string;
    wa_message_id?: string;
    sender_name?: string | null;
    sender_type?: string | null;
    direction?: string;
    content?: string;
    media?: ChatMediaData;
  } | null;
  payload_raw?: any;
}
