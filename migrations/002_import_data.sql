-- RasenBuerosport Leipzig - Cloud SQL Data Import
-- Migration 002: Import profiles and teams from Supabase export

BEGIN;

-- ============================================================
-- Profiles
-- ============================================================

INSERT INTO profiles (id, username, avatar_url, created_at) VALUES
  ('255002d0-a6ff-4685-80d0-0acaf67ea9ab', 'jeniffen.chandrabalan', NULL, '2026-03-12 10:19:45.861849+00'),
  ('bb93ec19-1551-4c14-920a-ab005deb3356', 'Nikinho', NULL, '2026-03-12 10:19:18.043619+00'),
  ('fe3a0b5b-b8a4-441f-829b-38d9924ca3c6', 'Florian', NULL, '2026-03-12 10:18:12.625355+00'),
  ('2c884921-950a-45fa-a552-ebcf51f9e400', 'blacky1707', NULL, '2026-03-12 10:18:44.62072+00'),
  ('80823558-3369-4807-a8fc-e1eb7bcc97e9', 'Marco', NULL, '2026-03-12 12:26:32.391455+00');

-- ============================================================
-- Teams
-- ============================================================

-- Superliga (DK)
INSERT INTO teams (id, name, short_name, logo_url, sofifa_id, overall_rating, star_rating, league_name, country_code) VALUES
  ('1763449b-271b-46e5-b8c1-0349d424e33c', 'FC København', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/85.png', 819, 72, 3.5, 'Superliga', 'DK'),
  ('053c0f45-a2c4-4fea-bc09-a48eeea04234', 'FC Midtjylland', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/939.png', 1516, 71, 3.5, 'Superliga', 'DK'),
  ('82232435-0c77-4ee9-996e-587f64957644', 'Brøndby IF', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/293.png', 269, 70, 3.0, 'Superliga', 'DK'),
  ('7efeb4d4-438e-4252-9f4c-39b48dc9ade1', 'Aarhus Gymnastikforening', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2905.png', 271, 70, 3.0, 'Superliga', 'DK'),
  ('39b562f1-4385-4458-841b-37d6a40c4581', 'Randers FC', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2356.png', 1786, 68, 2.5, 'Superliga', 'DK'),
  ('2a882cb9-fbef-4a1a-a592-6a8d5d2943e9', 'FC Nordsjælland', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2394.png', 1788, 67, 2.5, 'Superliga', 'DK'),
  ('2a00161b-70ba-4215-bb9b-06afd60e575a', 'Viborg FF', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2447.png', 1443, 67, 2.5, 'Superliga', 'DK'),
  ('4e445405-a62e-4761-bc2d-10cefaa8577b', 'Odense Boldklub', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/1789.png', 272, 66, 2.0, 'Superliga', 'DK'),
  ('c0aca461-e744-47fa-8c08-e48c557839ee', 'Vejle Boldklub', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/7466.png', 822, 65, 2.0, 'Superliga', 'DK'),
  ('f7c10701-3d0f-4238-8e2e-4502f719f877', 'Sønderjyske Fodbold', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/390.png', 1447, 64, 1.5, 'Superliga', 'DK'),
  ('87a8290f-cdca-45fe-86ab-ea91e6e03422', 'Fredericia', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2933.png', 15006, 63, 1.5, 'Superliga', 'DK');

-- Pro League (BE)
INSERT INTO teams (id, name, short_name, logo_url, sofifa_id, overall_rating, star_rating, league_name, country_code) VALUES
  ('7ff480c3-1102-43e1-a7f5-d7e23e7ec75e', 'KRC Genk', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2709.png', 673, 73, 3.5, 'Pro League', 'BE'),
  ('bcd2d7cb-1b7e-4b21-ba57-64258dc86a31', 'Union Saint-Gilloise', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/3958.png', 2014, 73, 3.5, 'Pro League', 'BE'),
  ('6cb4671f-f7d1-46b9-aced-3f20400458f1', 'RSC Anderlecht', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2555.png', 229, 72, 3.5, 'Pro League', 'BE'),
  ('f53d1c1e-dd5d-420f-992b-5daf13ca2308', 'Standard de Liège', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/700.png', 232, 70, 3.0, 'Pro League', 'BE'),
  ('3afa887a-caf6-4d24-b314-fb992d89b0b9', 'KAA Gent', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2402.png', 674, 70, 3.0, 'Pro League', 'BE'),
  ('8de20132-b458-40d3-ac0c-89f62591ccc2', 'KV Mechelen', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2938.png', 110724, 69, 3.0, 'Pro League', 'BE'),
  ('40d7bebb-8a46-4405-84b8-83f964b932ec', 'Sint-Truidense VV', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/355.png', 680, 69, 3.0, 'Pro League', 'BE'),
  ('125d40d2-f4d9-4878-867d-15a7dbbefd2e', 'Royal Charleroi Sporting Club', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/1087.png', 670, 69, 3.0, 'Pro League', 'BE'),
  ('623f0120-b049-42cb-bfad-56630c0dbc3d', 'KVC Westerlo', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/357.png', 681, 68, 2.5, 'Pro League', 'BE'),
  ('e70e92c2-db0a-43c0-aa63-f8f34a5d5748', 'SV Zulte Waregem', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/1118.png', 15005, 68, 2.5, 'Pro League', 'BE'),
  ('cd92df0b-e403-4053-a8c2-42debfb4bfbd', 'FCV Dender EH', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2741.png', 537, 67, 2.5, 'Pro League', 'BE'),
  ('bc379712-52a4-475c-a759-8305b560a463', 'RAAL La Louvière', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/6722.png', 132231, 67, 2.5, 'Pro League', 'BE');

-- Serie A (BR)
INSERT INTO teams (id, name, short_name, logo_url, sofifa_id, overall_rating, star_rating, league_name, country_code) VALUES
  ('aed93769-b53b-463f-a2c5-b5f4aeabb584', 'Flamengo', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/1024.png', 1043, 76, 4.0, 'Série A', 'BR'),
  ('7d4311ac-ec01-4ebb-ae65-523a1cba432b', 'Botafogo', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2864.png', 517, 75, 4.0, 'Série A', 'BR'),
  ('32c08de2-5591-44da-b9b6-d935d25ed1f7', 'Atlético Mineiro', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/3427.png', 1035, 75, 4.0, 'Série A', 'BR'),
  ('6bfb4a53-8c5f-45a4-bb42-f97f9b3352cd', 'Internacional', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2696.png', 1048, 74, 3.5, 'Série A', 'BR'),
  ('939603aa-a06e-4e9b-a79c-3a9bcfb0d164', 'São Paulo', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/3496.png', 598, 73, 3.5, 'Série A', 'BR'),
  ('30313aa8-46e9-473f-9b15-0c9600b7aff1', 'Cruzeiro', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/3371.png', 568, 72, 3.5, 'Série A', 'BR'),
  ('301083b5-9015-4634-b84f-9147b70ca829', 'Fluminense', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/1095.png', 567, 72, 3.5, 'Série A', 'BR'),
  ('e761b401-b507-4a20-ac04-8444118f0714', 'Bahia', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/692.png', 1598, 72, 3.5, 'Série A', 'BR'),
  ('97c240b3-cfda-4001-ada2-187eec5889b8', 'Fortaleza', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/3621.png', 111052, 71, 3.5, 'Série A', 'BR'),
  ('3cc231f1-06a3-4ed8-856c-2f34eead740b', 'Vasco da Gama', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/696.png', 569, 70, 3.0, 'Série A', 'BR');

-- Eredivisie (NL)
INSERT INTO teams (id, name, short_name, logo_url, sofifa_id, overall_rating, star_rating, league_name, country_code) VALUES
  ('b8689919-7ef9-4f14-97c8-0c925cf19dba', 'PSV', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/682.png', 247, 77, 4.0, 'Eredivisie', 'NL'),
  ('f5666664-c074-47bc-ab6b-b72365665c97', 'Ajax', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/629.png', 245, 75, 4.0, 'Eredivisie', 'NL'),
  ('e25434a9-52a3-4157-9643-4cfa81075702', 'Feyenoord', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/73.png', 246, 75, 4.0, 'Eredivisie', 'NL'),
  ('f2dcfecc-40d8-4b04-805a-54856e4716cd', 'AZ Alkmaar', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/61.png', 1906, 73, 3.5, 'Eredivisie', 'NL'),
  ('434a4668-86cb-4f8c-8465-45388901c0dd', 'NEC Nijmegen', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/494.png', 1910, 71, 3.5, 'Eredivisie', 'NL'),
  ('260cc9cf-c1f0-475e-bea3-65d56fdd00e5', 'Sparta Rotterdam', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/919.png', 100646, 68, 2.5, 'Eredivisie', 'NL'),
  ('ee3288e3-ff16-4b5c-9d2c-1cb0c17309d1', 'Fortuna Sittard', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/1459.png', 634, 68, 2.5, 'Eredivisie', 'NL'),
  ('bcf7159f-72f4-475b-96db-0f2a489903c8', 'Heracles Almelo', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/1403.png', 100634, 67, 2.5, 'Eredivisie', 'NL'),
  ('5322a9d8-eea4-442e-97ee-a1d4d9aab4b8', 'FC Groningen', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2345.png', 1915, 67, 2.5, 'Eredivisie', 'NL'),
  ('7cf89644-d39a-45b1-8815-20b5be41fbbe', 'PEC Zwolle', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/1016.png', 1914, 67, 2.5, 'Eredivisie', 'NL'),
  ('3423ca4c-5468-456d-b75b-181fe7bb0e52', 'SC Heerenveen', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/1053.png', 1913, 67, 2.5, 'Eredivisie', 'NL'),
  ('a00d8b3f-192b-482c-bd45-ae226452e3e3', 'FC Volendam', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2396.png', 645, 66, 2.0, 'Eredivisie', 'NL'),
  ('4afdf95a-0f82-4a87-bc9d-5a09ac686f8e', 'Telstar', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/1550.png', 100638, 65, 2.0, 'Eredivisie', 'NL');

-- Bundesliga (DE)
INSERT INTO teams (id, name, short_name, logo_url, sofifa_id, overall_rating, star_rating, league_name, country_code) VALUES
  ('fc39a98c-3eda-4879-93ce-5da989a6a81c', 'Borussia Mönchengladbach', 'BMG', 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/683.png', 23, 75, 4.0, 'Bundesliga', 'DE'),
  ('f2f10780-9682-47bd-80f0-ddabc0868489', 'Werder Bremen', 'SVW', 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/82.png', 38, 75, 4.0, 'Bundesliga', 'DE'),
  ('f776ffab-a725-4674-a5a1-12240c214ccf', '1. FC Köln', 'KOE', 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/3320.png', 31, 74, 3.5, 'Bundesliga', 'DE'),
  ('fbf85944-aaee-474f-8113-08be24868b42', 'FC Augsburg', 'FCA', 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/90.png', 100409, 74, 3.5, 'Bundesliga', 'DE');

-- Premier League (GB-ENG)
INSERT INTO teams (id, name, short_name, logo_url, sofifa_id, overall_rating, star_rating, league_name, country_code) VALUES
  ('636612aa-3e05-468a-8d85-10fa0c25e6a3', 'Arsenal', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/19.png', 1, 85, 5.0, 'Premier League', 'GB-ENG'),
  ('48a517c9-b6b9-4a50-ab18-8506362bb748', 'Manchester City', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/9.png', 10, 84, 5.0, 'Premier League', 'GB-ENG'),
  ('220b6a84-9e27-415d-8875-25c471673e2f', 'Tottenham Hotspur', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/6.png', 18, 81, 4.5, 'Premier League', 'GB-ENG'),
  ('a2bfc204-d974-494f-b90e-78ba814a8da2', 'Newcastle United', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/20.png', 13, 81, 4.5, 'Premier League', 'GB-ENG'),
  ('de593464-0be6-43de-9655-cbdbac15145b', 'Chelsea', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/18.png', 5, 81, 4.5, 'Premier League', 'GB-ENG'),
  ('3fd20a80-8c29-4ef8-963a-b95176b71a91', 'Manchester United', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/14.png', 11, 80, 4.5, 'Premier League', 'GB-ENG'),
  ('50519b08-b111-4f28-aadc-af7af6618962', 'Crystal Palace', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/51.png', 1799, 79, 4.5, 'Premier League', 'GB-ENG'),
  ('bf137094-70fa-41cb-b1be-d26a5d196103', 'Brighton & Hove Albion', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/78.png', 1808, 78, 4.0, 'Premier League', 'GB-ENG'),
  ('e48ff1e7-b602-436c-b9cc-2a83b7cb8c3a', 'AFC Bournemouth', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/52.png', 1943, 78, 4.0, 'Premier League', 'GB-ENG'),
  ('48272f70-b244-43df-9b62-acbe741e7443', 'Everton', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/13.png', 7, 78, 4.0, 'Premier League', 'GB-ENG'),
  ('e2e24692-1f01-44e7-85c8-08350dd41a85', 'Fulham FC', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/11.png', 144, 78, 4.0, 'Premier League', 'GB-ENG'),
  ('938b51a7-9067-4025-b472-f89854c6b574', 'Sunderland', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/3.png', 106, 77, 4.0, 'Premier League', 'GB-ENG'),
  ('69c85f20-ced6-4fa3-8f57-1fefbbb92bde', 'West Ham United', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/1.png', 19, 77, 4.0, 'Premier League', 'GB-ENG'),
  ('855e5272-12b5-42dd-8ae9-f0be7d5e31d3', 'Leeds United', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/71.png', 8, 76, 4.0, 'Premier League', 'GB-ENG'),
  ('3f318410-9ef5-4864-b337-653cc48cdef1', 'Wolverhampton Wanderers', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/29.png', 110, 75, 4.0, 'Premier League', 'GB-ENG');

-- Championship (GB-ENG)
INSERT INTO teams (id, name, short_name, logo_url, sofifa_id, overall_rating, star_rating, league_name, country_code) VALUES
  ('ff6daef9-5260-4169-8a2e-b5d24c8f1923', 'Ipswich Town', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/116.png', 94, 73, 3.5, 'Championship', 'GB-ENG'),
  ('8cd48b7d-6a44-4b9e-9923-49e6d0eededf', 'Coventry City', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/117.png', 1800, 72, 3.5, 'Championship', 'GB-ENG'),
  ('423c9b58-b583-457a-8967-8a1395b2cfeb', 'Sheffield United', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/21.png', 1794, 72, 3.5, 'Championship', 'GB-ENG'),
  ('13ec67cd-a852-4ddf-b72c-eab3f9bb62d9', 'Birmingham City', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/12.png', 88, 72, 3.5, 'Championship', 'GB-ENG'),
  ('fd443701-4496-4c48-afc7-b832d5c6b195', 'Southampton', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/65.png', 17, 72, 3.5, 'Championship', 'GB-ENG'),
  ('00465383-5196-4ece-9cc5-65646b837aac', 'Wrexham', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/283.png', 1947, 71, 3.5, 'Championship', 'GB-ENG'),
  ('dea72dfe-b631-490e-bc29-620772521131', 'Hull City', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/22.png', 1952, 71, 3.5, 'Championship', 'GB-ENG'),
  ('d2d34701-2150-4948-aef6-70f49aa3035e', 'Millwall FC', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/64.png', 97, 71, 3.5, 'Championship', 'GB-ENG'),
  ('66f0f28e-0aef-48f2-b947-8e7a05e63e7a', 'Stoke City', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/26.png', 1806, 71, 3.5, 'Championship', 'GB-ENG'),
  ('2848f31f-ef58-494f-b406-cf45fb3a8292', 'Swansea City', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/30.png', 1960, 71, 3.5, 'Championship', 'GB-ENG'),
  ('ed0e25f7-ce96-49a8-af43-b4e851757591', 'Preston North End', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/99.png', 1801, 70, 3.0, 'Championship', 'GB-ENG'),
  ('7545cba5-8788-46f2-a059-ace308d72b4b', 'Watford', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/25.png', 1795, 70, 3.0, 'Championship', 'GB-ENG'),
  ('40483a21-4426-4f1a-a45b-c96dc10193bb', 'West Bromwich Albion', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/10.png', 109, 70, 3.0, 'Championship', 'GB-ENG'),
  ('a9963e99-130a-4ff3-a63d-ae821be7bae2', 'Derby County', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/24.png', 91, 70, 3.0, 'Championship', 'GB-ENG'),
  ('80dd6675-f559-4f52-93da-d9742bbaf175', 'Queens Park Rangers', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/47.png', 15, 70, 3.0, 'Championship', 'GB-ENG'),
  ('3e328a35-e453-4e5d-8246-11b1fc879d9a', 'Charlton Athletic', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/4.png', 89, 69, 3.0, 'Championship', 'GB-ENG'),
  ('351ea9f5-127c-4141-9d1b-794133b34d4d', 'Oxford United', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/297.png', 1951, 69, 3.0, 'Championship', 'GB-ENG'),
  ('c3487bb7-d3a1-4035-8511-6043c5da84db', 'Blackburn Rovers', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2.png', 3, 69, 3.0, 'Championship', 'GB-ENG');

-- Ligue 1 (FR)
INSERT INTO teams (id, name, short_name, logo_url, sofifa_id, overall_rating, star_rating, league_name, country_code) VALUES
  ('e089233e-49be-4344-b51d-91c602849d87', 'Olympique de Marseille', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/44.png', 219, 79, 4.5, 'Ligue 1', 'FR'),
  ('d8e70b4a-ed4a-4780-a451-b30588d7b44f', 'AS Monaco', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/6789.png', 69, 78, 4.0, 'Ligue 1', 'FR'),
  ('ca5c5d38-e33d-47be-a8b8-eff6ac8bade7', 'Lille OSC', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/690.png', 65, 77, 4.0, 'Ligue 1', 'FR'),
  ('4fa24cb4-a9bd-4b8b-bf85-744563b0cfbb', 'Stade Rennais FC', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/598.png', 74, 76, 4.0, 'Ligue 1', 'FR'),
  ('70aee083-2830-4b28-999d-0e537ef6d710', 'RC Lens', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/271.png', 64, 76, 4.0, 'Ligue 1', 'FR'),
  ('f6984381-d45d-4e45-a566-fc4fe4934524', 'RC Strasbourg Alsace', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/686.png', 76, 75, 4.0, 'Ligue 1', 'FR'),
  ('538aff3d-f544-4bb6-9ce4-b41fd13305a7', 'Paris FC', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/4508.png', 111817, 75, 4.0, 'Ligue 1', 'FR'),
  ('36c9536c-4f96-49d1-9b8b-dfc9552cf31b', 'Stade Brestois 29', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/266.png', 378, 74, 3.5, 'Ligue 1', 'FR'),
  ('23683962-7997-4195-802a-56ce834fdcae', 'FC Nantes', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/59.png', 71, 73, 3.5, 'Ligue 1', 'FR'),
  ('8b413044-79bf-4777-8e5f-962d772601e1', 'Toulouse FC', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/289.png', 1809, 72, 3.5, 'Ligue 1', 'FR'),
  ('7a6fd8ff-2903-4331-ac20-56cdc161da99', 'AJ Auxerre', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/3682.png', 57, 72, 3.5, 'Ligue 1', 'FR'),
  ('7d19fb6f-0e82-4eeb-aa13-553ec5a2e348', 'FC Metz', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/3513.png', 68, 71, 3.5, 'Ligue 1', 'FR'),
  ('55401342-4c7d-4e3f-8778-f131b2394d0e', 'Le Havre AC', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/1055.png', 1738, 71, 3.5, 'Ligue 1', 'FR');

-- Ligue 2 (FR)
INSERT INTO teams (id, name, short_name, logo_url, sofifa_id, overall_rating, star_rating, league_name, country_code) VALUES
  ('0a26a5e3-7279-41b8-aca9-21ab6da7773b', 'AS Saint-Étienne', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/108.png', 1819, 70, 3.0, 'Ligue 2', 'FR'),
  ('c27d2b43-8f82-46d9-a1d7-d08f2c520f92', 'Stade de Reims', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/1028.png', 379, 69, 3.0, 'Ligue 2', 'FR'),
  ('2fde71b0-93b5-47ac-84da-3af7b0e30e79', 'Amiens SC', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/840.png', 1816, 67, 2.5, 'Ligue 2', 'FR'),
  ('6e50063c-777d-46fd-87c1-714decb752c9', 'En Avant Guingamp', NULL, 'https://uadwqkbqvabfjtvdeumr.supabase.co/storage/v1/object/public/team-logos/2919.png', 62, 67, 2.5, 'Ligue 2', 'FR');

COMMIT;
