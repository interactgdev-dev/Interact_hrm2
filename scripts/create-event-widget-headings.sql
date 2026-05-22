-- Migration: Create event_widget_headings table
CREATE TABLE event_widget_headings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  heading VARCHAR(100) NOT NULL,
  display_order INT DEFAULT 1,
  status ENUM('active','inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert default headings
INSERT INTO event_widget_headings (heading, display_order, status) VALUES
  ('Upcoming Events', 1, 'active'),
  ('Announcements', 2, 'active'),
  ('Company Policies', 3, 'active');
