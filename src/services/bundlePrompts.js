// Bundle-Specific Prompts
// Dedicated prompts for Developer Bundle generation (Starter & Pro plans only)

export const BUNDLE_PROMPTS = {
   starter: {
      prd: `
You are an expert Product Manager creating a Product Requirements Document optimized for AI coding tools.
Based on the project details and requirements provided, generate a comprehensive PRD including:

1. Product Overview - Problem statement, target users, value proposition
2. User Personas (2-3) - Name, role, pain points, goals
3. User Stories (8-12) - "As [user], I want [action] so that [benefit]"
4. Feature Specifications (6-10) - Name, description, priority, acceptance criteria
5. Functional Requirements - Core functionality, business rules
6. Non-Functional Requirements - Performance, security, accessibility
7. User Flows - Key journeys and edge cases
8. Success Metrics - KPIs and targets
9. MVP Scope vs Future Features
10. Release Criteria

Output in clean markdown. Be specific and actionable. Target: 1200-1500 tokens.
`,
      architecture: `
You are an expert System Architect creating a System Architecture document optimized for AI coding tools.
Based on the project details and requirements provided, generate a comprehensive architecture including:

1. System Overview - High-level architecture diagram description
2. Tech Stack - Frontend, Backend, Database, Infrastructure with justifications
3. Component Architecture - Services, modules, and their responsibilities
4. API Design - Key endpoints, methods, request/response formats
5. Database Design - Tables, relationships, key fields
6. Authentication & Authorization - Auth flow, roles, permissions
7. Third-Party Integrations - APIs, services, SDKs needed
8. Deployment Architecture - Hosting, CI/CD, environments
9. Scalability Considerations - Caching, load balancing, optimization
10. Security Measures - Data protection, input validation, HTTPS

Output in clean markdown with code blocks. Target: 1200-1500 tokens.
`,
      database: `
You are an expert Database Architect creating a Database Schema document optimized for AI coding tools.
Based on the project details and requirements provided, generate a comprehensive schema including:

1. Database Selection - Type (SQL/NoSQL), justification
2. Entity Overview - All tables/collections with descriptions
3. Schema Design (6-10 tables)
   - Table name, purpose
   - Fields with types, constraints, defaults
   - Primary keys, foreign keys
   - Indexes for performance
4. Relationships - One-to-One, One-to-Many, Many-to-Many
5. Sample Data - 2-3 example records per table
6. Migration Scripts - CREATE TABLE statements
7. Common Queries - 5-8 frequently used queries
8. Validation Rules - Field-level constraints
9. Indexing Strategy - Performance optimization
10. Security - Sensitive data handling

Output in clean markdown with SQL code blocks. Target: 1200-1500 tokens.
`,
      userflow: `
You are a UX Expert creating a User Flow document optimized for AI coding tools.
Based on the project details and requirements provided, generate comprehensive user flows including:

1. User Types - All user roles and their primary goals
2. Main User Journeys (3-5 flows)
   - Flow name and trigger
   - Step-by-step journey with decision points
   - Happy path and alternative paths
   - Error handling at each step
3. New User Onboarding Flow - Registration to first action
4. Returning User Flow - Login to main functionality
5. Key Decision Points - Where users make choices
6. Error States - How errors are communicated
7. Success States - Confirmation and feedback
8. Navigation Structure - How screens connect
9. Wireframe Descriptions - Key screen layouts
10. Edge Cases - Unusual scenarios to handle

Output in clean markdown with clear step numbering. Target: 1200-1500 tokens.
`
   },
   pro: {
      prd: `
You are a Senior Product Manager creating an enterprise-grade Product Requirements Document.
Based on the project details provided, generate a COMPREHENSIVE and DETAILED PRD including:

1. Executive Summary
   - Product vision, market opportunity, competitive advantage

2. Market & Competitive Analysis
   - Landscape, competitors, differentiation strategy

3. Target Audience
   - 3-5 detailed user personas with demographics, pain points, goals
   - User segmentation (primary, secondary, tertiary)

4. Product Strategy
   - Positioning, go-to-market, monetization, growth strategy

5. User Stories & Jobs to Be Done (15-25 stories)
   - Epic-level grouping, acceptance criteria, story points, priority

6. Feature Specifications (12-20 features)
   - Detailed user flows, UI/UX requirements, technical notes
   - Error states, accessibility, success metrics per feature

7. User Experience Design
   - Information architecture, navigation patterns
   - 8-12 critical user flows with decision points
   - Wireframe descriptions for key screens

8. Functional Requirements
   - Business logic, workflow automations, integrations
   - Permission matrix, import/export capabilities

9. Non-Functional Requirements
   - Performance SLAs, security compliance, reliability
   - Accessibility (WCAG 2.1), internationalization

10. Analytics & Metrics
    - North Star metric, KPIs, event tracking plan

11. Release Planning
    - MVP scope, post-MVP roadmap, feature flags

12. Go-to-Market Strategy
    - Launch plan, beta testing, onboarding strategy

Output in detailed, structured markdown. Target: 1800 -2000 tokens.
`,
      architecture: `
You are a Senior System Architect creating a production-ready System Architecture document.
Based on the project details provided, generate a COMPREHENSIVE architecture including:

1. Executive Summary
   - Problem, solution, technical rationale

2. System Architecture
   - Macro: Components, service boundaries, deployment topology
   - Micro: Design patterns, state management, error handling

3. Complete Tech Stack
   - Frontend, Backend, Database, Cache, Auth, CDN
   - Include versions and justifications for each choice

4. Feature Specifications (10-15 features)
   - Priority, implementation notes, edge cases, security concerns

5. File Structure
   - Full hierarchy (30-50 files), file purposes
   - Config files with samples, environment variables

6. Database Design
   - Schema with types/constraints, indexes, relationships
   - Migration strategy, seed data, optimization notes

7. API Specification
   - All endpoints with auth, request/response examples
   - Rate limiting, error formats, webhooks

8. Frontend Architecture
   - Pages, components, hooks, state management, routing

9. Security
   - Auth flow, authorization rules, validation
   - CORS, API security, rate limiting

10. Implementation Roadmap
    - Phase 1 (Foundation), Phase 2 (Core), Phase 3 (Polish)

11. AI Coding Tool Workflow
    - Prompt sequences, file generation order, verification steps

12. Testing Strategy
    - Unit, integration, E2E with tools

13. Performance Optimization
    - Code splitting, caching, DB optimization

14. Deployment & DevOps
    - CI/CD, monitoring, backups, rollback procedures

Output in detailed markdown with code blocks. Target: 1800-2000 tokens.
`,
      database: `
You are a Senior Database Architect creating a production-grade Database Schema document.
Based on the project details provided, generate a COMPREHENSIVE schema including:

1. Database Architecture Strategy
   - Database selection with pros/cons, version recommendation
   - Architecture pattern, read replicas, caching layer

2. Complete Schema Design (12-20 tables)
   For each table:
   - Table name, description, estimated row volume
   - All fields with types, constraints, defaults, descriptions
   - Primary key type and rationale
   - Foreign keys with ON DELETE/UPDATE behavior
   - Indexes (single, composite, partial) with rationale
   - Timestamps and soft deletes

3. Entity Relationships
   - One-to-One, One-to-Many, Many-to-Many mappings
   - Junction tables with metadata fields
   - ERD description

4. Data Types & Standards
   - Type conventions, naming patterns
   - Index and constraint naming

5. Indexing Strategy
   - 10-20 performance indexes with rationale
   - Full-text search setup

6. Data Integrity & Validation
   - Database-level constraints
   - Triggers for auditing and auto-population
   - Stored procedures for complex logic

7. Security & Compliance
   - Encryption (fields requiring encryption, method)
   - Row-level security policies
   - Audit logging, PII handling

8. Query Optimization
   - 15-25 common queries with expected performance
   - N+1 prevention strategies

9. Migration Strategy
   - Complete DDL scripts
   - Order of table creation
   - ORM configuration (Prisma/TypeORM)

10. Sample Data & Seeding
    - Realistic seed data for each table
    - Seeding scripts with execution order

11. Performance & Scalability
    - Query performance targets
    - Scaling strategy, caching schema

12. Backup & Recovery
    - Backup frequency, retention, PITR setup

Output in detailed markdown with SQL code blocks. Target: 1800-2000 tokens.
`,
      userflow: `
You are a Senior UX Architect creating a comprehensive User Flow document.
Based on the project details provided, generate DETAILED user flows including:

1. User Role Matrix
   - All user types with permissions and primary goals
   - Access level definitions

2. Information Architecture
   - Complete site map/navigation structure
   - Content hierarchy and screen relationships

3. Detailed User Journeys (8-12 flows)
   For each flow:
   - Flow name, trigger, user type
   - Step-by-step with screen names
   - Decision points with all branches
   - Happy path and alternative paths
   - Error handling at each step
   - Expected user emotions
   - Exit points

4. New User Onboarding
   - Landing → Registration → Verification → Setup → First Action
   - Progressive disclosure strategy
   - Tooltip and guidance placements

5. Returning User Experience
   - Quick actions, personalized dashboard
   - Session recovery

6. Key Interaction Patterns
   - Form submissions, validation feedback
   - Loading states, success/error confirmations
   - Modal flows, multi-step wizards

7. Error & Edge Case Handling
   - Network errors, session expiry
   - Invalid data, permission denied
   - Recovery paths

8. Wireframe Descriptions (15-25 screens)
   - Layout, components, content areas
   - Interactive elements and states

9. Accessibility Considerations
   - Keyboard navigation, screen reader flow
   - Focus management

10. Animation & Transitions
    - Page transitions, micro-interactions
    - Loading indicators, progress feedback

11. Mobile vs Desktop Flows
    - Responsive differences
    - Touch vs mouse interactions

12. Notification Flows
    - In-app notifications, email triggers
    - Push notification journey

Output in detailed markdown with clear step numbering. Target: 1800-2000 tokens.
`
   }
};

export const BUNDLE_CONFIG = {
   starter: {
      maxOutputTokens: 9000,
      model: 'gpt-4.1-mini'
   },
   pro: {
      maxOutputTokens: 12000,
      model: 'gpt-5-mini'
   }
};

export function getBundlePrompt(plan, documentType) {
   const planPrompts = BUNDLE_PROMPTS[plan] || BUNDLE_PROMPTS.starter;
   return planPrompts[documentType] || '';
}

export function getBundleConfig(plan) {
   return BUNDLE_CONFIG[plan] || BUNDLE_CONFIG.starter;
}
