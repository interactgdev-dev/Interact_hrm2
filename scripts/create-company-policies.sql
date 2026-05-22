-- Migration: Create company_policies table
CREATE TABLE company_policies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  heading VARCHAR(100) NOT NULL,
  description TEXT,
  display_order INT DEFAULT 1,
  status ENUM('active','inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insert default heading
INSERT INTO company_policies (heading, description, display_order, status) VALUES
  ('Company Policies', 'Describe your company policy here.', 1, 'active');
