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

export type LeaderboardRow = {
  id: string;
  full_name: string;
  photo_url: string | null;
  scan_count: number;
};
