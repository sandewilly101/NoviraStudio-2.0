CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('designer','admin') NOT NULL DEFAULT 'designer',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS brand_kits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  logo_url VARCHAR(500) NULL,
  colors JSON NOT NULL,
  fonts JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS venues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(160) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  analysis JSON NULL,
  status ENUM('uploaded','ready') NOT NULL DEFAULT 'uploaded',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  venue_id INT NULL,
  brand_kit_id INT NULL,
  name VARCHAR(160) NOT NULL,
  event_type VARCHAR(60) NOT NULL DEFAULT 'gala',
  guests INT NOT NULL DEFAULT 100,
  brief TEXT NULL,
  status ENUM('draft','in_review','approved') NOT NULL DEFAULT 'draft',
  share_token VARCHAR(40) NULL UNIQUE,
  thumbnail_url VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL,
  FOREIGN KEY (brand_kit_id) REFERENCES brand_kits(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS scene_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  version INT NOT NULL,
  label VARCHAR(200) NULL,
  scene JSON NOT NULL,
  created_by VARCHAR(60) NOT NULL DEFAULT 'user',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_project_version (project_id, version),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  source VARCHAR(40) NOT NULL,
  external_id VARCHAR(80) NULL,
  name VARCHAR(200) NOT NULL,
  author VARCHAR(200) NULL,
  license VARCHAR(80) NULL,
  thumbnail_url VARCHAR(500) NULL,
  file_url VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_source_ext (source, external_id)
);

CREATE TABLE IF NOT EXISTS renders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  kind ENUM('image','enhanced','panorama','video','floorplan') NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  prompt TEXT NULL,
  version INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS comments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  author_name VARCHAR(120) NOT NULL,
  author_role VARCHAR(40) NOT NULL DEFAULT 'client',
  body TEXT NOT NULL,
  position JSON NULL,
  resolved TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS approvals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  version INT NOT NULL,
  approver_name VARCHAR(120) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Images and videos for LED walls, posters, banners and other display surfaces.
CREATE TABLE IF NOT EXISTS media (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  kind ENUM('image','video') NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'upload',
  name VARCHAR(200) NOT NULL,
  file_url VARCHAR(500) NOT NULL,
  width INT NULL,
  height INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- People a project's owner invited to design it with them, live.
CREATE TABLE IF NOT EXISTS project_members (
  project_id INT NOT NULL,
  user_id INT NOT NULL,
  role ENUM('editor','viewer') NOT NULL DEFAULT 'editor',
  invited_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Models chosen by the sourcing step (ai/sourcing.js), so an item is searched and scored once, not per event.
CREATE TABLE IF NOT EXISTS sourced_models (
  item VARCHAR(160) NOT NULL,
  theme VARCHAR(255) NOT NULL DEFAULT '',
  choice JSON NULL,
  score DECIMAL(4,1) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (item, theme)
);

-- Every call to a paid AI service: what, for whom, how much (cost is an estimate from list prices).
CREATE TABLE IF NOT EXISTS api_usage (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  provider VARCHAR(30) NOT NULL,
  model VARCHAR(60) NOT NULL,
  feature VARCHAR(60) NOT NULL,
  kind ENUM('text','image') NOT NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  images INT NOT NULL DEFAULT 0,
  cost_usd DECIMAL(12,6) NULL,
  ok TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY usage_user_time (user_id, created_at)
);
