export type SocialPlatform = 'instagram' | 'facebook' | 'twitter' | 'tiktok';

export type SocialHandle = {
  id: string;
  profile_id: string;
  platform: SocialPlatform;
  handle: string;
  created_at: string;
};

export type Profile = {
  id: string;
  first_name: string;
  photo_url: string | null;
  is_admin: boolean;
  created_at: string;
  profile_socials: SocialHandle[];
};

export type Scan = {
  id: string;
  scanner_id: string;
  scanned_id: string;
  points: number;
  created_at: string;
};

export type DoublePointsWindow = {
  id: string;
  start_time: string;
  end_time: string;
  created_at: string;
};

export type Favorite = {
  user_id: string;
  contact_id: string;
  created_at: string;
};

export type Event = {
  id: string;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  location_name: string;
  address: string;
  image_url: string | null;
  image_opacity: number;
  created_at: string;
};

export type EventCheckin = {
  id: string;
  user_id: string;
  event_id: string;
  created_at: string;
};

export type ServiceRequest = {
  id: string;
  user_id: string;
  message: string;
  admin_reply: string | null;
  replied_at: string | null;
  replied_by: string | null;
  created_at: string;
};

export type ConnectionRequestStatus = 'pending' | 'accepted' | 'declined' | 'expired';

export type ConnectionRequest = {
  id: string;
  requester_id: string;
  target_id: string;
  status: ConnectionRequestStatus;
  created_at: string;
  responded_at: string | null;
};

export type Report = {
  id: string;
  reporter_id: string;
  reported_id: string;
  reason: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  // Set when the reporter themselves withdrew the report — distinct from
  // resolved_at, which is the admin's own resolution signal.
  rescinded_at: string | null;
};

export type Announcement = {
  id: string;
  admin_id: string | null;
  title: string;
  body: string;
  created_at: string;
};

export type RafflePrize = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  created_at: string;
  closes_at: string | null;
  drawn_at: string | null;
  winner_id: string | null;
  winner_seen: boolean;
};

export type RaffleEntry = {
  id: string;
  user_id: string;
  prize_id: string;
  tickets: number;
  created_at: string;
};

export type RafflePrizeStats = {
  prize_id: string;
  total_tickets: number;
  entrant_count: number;
};

export type LeaderboardRow = {
  id: string;
  first_name: string;
  photo_url: string | null;
  scan_count: number;
  event_count: number;
  points: number;
};
