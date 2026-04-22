export type Profile = {
  id: string;
  full_name: string;
  background: string | null;
  hometown: string | null;
  photo_url: string | null;
  phone: string | null;
  is_admin: boolean;
  created_at: string;
};

export type Scan = {
  id: string;
  scanner_id: string;
  scanned_id: string;
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

export type Announcement = {
  id: string;
  admin_id: string | null;
  title: string;
  body: string;
  created_at: string;
};

export type LeaderboardRow = {
  id: string;
  full_name: string;
  photo_url: string | null;
  scan_count: number;
  event_count: number;
  points: number;
};
