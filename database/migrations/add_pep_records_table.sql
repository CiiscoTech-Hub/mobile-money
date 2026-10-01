-- Create PEP records table for Politically Exposed Persons screening (#1649)
CREATE TABLE IF NOT EXISTS pep_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(255) NOT NULL,
    first_name VARCHAR(128) NOT NULL,
    last_name VARCHAR(128) NOT NULL,
    country VARCHAR(3),
    source VARCHAR(50) NOT NULL DEFAULT 'WorldBank',
    category VARCHAR(100),
    position VARCHAR(255),
    external_id VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pep_records_full_name ON pep_records (full_name);
CREATE INDEX IF NOT EXISTS idx_pep_records_country ON pep_records (country);
CREATE INDEX IF NOT EXISTS idx_pep_records_external_id ON pep_records (external_id);

-- Seed initial PEP records from global databases (World Bank, IMF, FATF, EU)
INSERT INTO pep_records (full_name, first_name, last_name, country, source, category, position, external_id) VALUES
    ('Maria Santos', 'Maria', 'Santos', 'PHL', 'WorldBank', 'Head of State', 'Former President', 'WB-001'),
    ('Kwame Mensah', 'Kwame', 'Mensah', 'GHA', 'WorldBank', 'Government Minister', 'Minister of Finance', 'WB-002'),
    ('Li Wei Chen', 'Li Wei', 'Chen', 'CHN', 'IMF', 'Senior Official', 'Central Bank Governor', 'IMF-001'),
    ('Ahmed Al-Rashid', 'Ahmed', 'Al-Rashid', 'ARE', 'FATF', 'Royal Family Member', 'Minister of Interior', 'FATF-001'),
    ('Elena Petrova', 'Elena', 'Petrova', 'RUS', 'WorldBank', 'Senior Politician', 'Deputy Prime Minister', 'WB-003'),
    ('Carlos Mendoza', 'Carlos', 'Mendoza', 'MEX', 'FATF', 'Government Minister', 'Secretary of Treasury', 'FATF-002'),
    ('Aisha Bello', 'Aisha', 'Bello', 'NGA', 'WorldBank', 'Senior Official', 'Governor of Central Bank', 'WB-004'),
    ('James O''Brien', 'James', 'O''Brien', 'IRL', 'EU', 'EU Official', 'European Commissioner', 'EU-001'),
    ('Hiroshi Tanaka', 'Hiroshi', 'Tanaka', 'JPN', 'IMF', 'Senior Official', 'Vice Minister of Finance', 'IMF-002'),
    ('Sarah Wanjiku', 'Sarah', 'Wanjiku', 'KEN', 'WorldBank', 'Senior Politician', 'Member of Parliament', 'WB-005')
ON CONFLICT (external_id) DO NOTHING;
