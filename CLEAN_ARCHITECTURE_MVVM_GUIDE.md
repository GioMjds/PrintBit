# PrintBit Clean Architecture + MVVM Implementation Guide

This guide is tailored to your current solution:
- `PrintBit.Domain`
- `PrintBit.Application`
- `PrintBit.Infrastructure`
- `PrintBit.Presentation` (WPF, MaterialDesign packages already installed)

It is written for a **UI-first workflow**: start by building design-ready WPF screens, then wire use-cases and persistence without breaking layer boundaries.

---

## 1) Architecture Rules (Non-Negotiable)

### Dependency direction
- `Presentation` -> `Application`
- `Infrastructure` -> `Application` and `Domain`
- `Application` -> `Domain`
- `Domain` -> (nothing)

### What each layer owns
- **Domain**: business rules, invariants, core models.
- **Application**: use-case orchestration, DTOs, contracts for external dependencies.
- **Infrastructure**: database/external adapters implementing contracts.
- **Presentation**: WPF Views + ViewModels + commands + UI state.

### Anti-patterns to avoid
- Domain referencing EF Core, WPF, or HTTP packages.
- View code-behind containing business rules.
- Application directly using EF `DbContext`.
- Presentation directly using Infrastructure concrete classes (always use DI + interfaces/use-cases).

---

## 2) Recommended Folder Blueprint (Use Existing Folders)

## Domain (`PrintBit.Domain`)
- `Entities/`
- `ValueObjects/`
- `Enums/`
- `Interfaces/` (domain-level abstractions only, if needed)

## Application (`PrintBit.Application`)
- `Interfaces/` (e.g., repositories/gateways/use-case contracts)
- `DTOs/`
- `Mappings/`
- `Services/` (use-case handlers/orchestrators)
- `DependencyInjection/` (add `AddApplication`)

## Infrastructure (`PrintBit.Infrastructure`)
- `Persistence/` (DbContext, EF configs, repository implementations)
- `Services/` (external adapters: printer, payments, etc.)
- `DependecyInjection/` (existing folder name; add `AddInfrastructure`)

## Presentation (`PrintBit.Presentation`)
- `Views/`
- `ViewModels/`
- `Converters/`
- `Behaviors/`
- `DependencyInjection/` (add `AddPresentation`)
- `App.xaml` / `App.xaml.cs` composition root

---

## 3) UI-First Track with MaterialDesign (Presentation first)

You already have:
- `MaterialDesignThemes` 5.3.0
- `MaterialDesignColors` 5.3.0

### 3.1 Theme setup in `App.xaml`
Add MaterialDesign resource dictionaries before building screens:
- MaterialDesign base theme dictionary
- Defaults dictionary
- Primary/Secondary color dictionaries

This gives immediate styled controls for wireframes and final UI.

### 3.2 ViewModel-first for each screen
For every screen:
1. Create `View` (`XAML`) under `Views/`.
2. Create matching `ViewModel` under `ViewModels/`.
3. Expose bindable properties for all UI state.
4. Expose `ICommand` for all interactions.
5. Keep code-behind limited to view-only behavior (animations, focus, visual events).

### 3.3 Suggested screen composition pattern
- Use a shell window (your `MainWindow`) hosting current content.
- Switch content via:
  - `CurrentViewModel` pattern, or
  - navigation service interface in Application.
- Use MaterialDesign components (`Card`, styled `Button`, `DialogHost`) only in Presentation.

---

## 4) Domain Layer Implementation Guide

Domain should answer: **"What is valid business behavior?"**

### 4.1 Entities
- Create core entities with private setters where possible.
- Enforce invariants in constructors/methods (never in UI).
- Example concepts for print kiosk domain:
  - `PrintJob`
  - `PaymentSession`
  - `Receipt`

### 4.2 Value Objects
- Use for strongly-typed concepts:
  - `Money`
  - `PageCount`
  - `DocumentId`
- Make immutable and equality-based.

### 4.3 Domain Enums
- Keep lifecycle states explicit:
  - `PrintJobStatus`
  - `PaymentStatus`

### 4.4 Domain interfaces (optional)
- Only for true domain abstractions.
- Do not place infra-specific contracts here unless they are domain concepts.

---

## 5) Application Layer Implementation Guide

Application should answer: **"How do use-cases execute?"**

### 5.1 DTOs
- Define request/response DTOs per use-case.
- Keep DTOs simple and serialization-friendly.

### 5.2 Interfaces
- Define ports that Application depends on:
  - repositories
  - payment/printer gateway abstractions
  - unit-of-work abstractions if needed

### 5.3 Services (use-cases)
- One service/handler per use-case action:
  - create print job
  - validate payment
  - complete print
- Validate input, call Domain behavior, persist via interfaces, return DTO.

### 5.4 Mapping
- Keep mapping logic in `Mappings/` (manual mapping is fine for now).

### 5.5 DI extension
- Add `AddApplication(this IServiceCollection services)` in `DependencyInjection`.
- Register all use-case services/interfaces here.

---

## 6) Infrastructure Layer Implementation Guide

Infrastructure should answer: **"How do we talk to real systems?"**

### 6.1 Persistence
- Add `DbContext` in `Persistence/`.
- Add EF entity configurations (fluent API).
- Implement repository interfaces from Application.

### 6.2 External adapters
- Implement printer, payment, upload, and machine IO adapters in `Services/`.
- Keep retries/timeouts explicit and observable (no silent failures).

### 6.3 DI extension
- Add `AddInfrastructure(this IServiceCollection services, string connectionString)`.
- Register:
  - `DbContext` with SQLite provider
  - repository implementations
  - external service adapters

---

## 7) Presentation Layer Implementation Guide (WPF + MVVM)

Presentation should answer: **"How is state shown and user input captured?"**

### 7.1 Composition root (`App.xaml.cs`)
- Instantiate `ServiceCollection`.
- Call:
  - `AddInfrastructure(connectionString)`
  - `AddApplication()`
  - `AddPresentation()`
- Resolve and show `MainWindow`.

### 7.2 Presentation DI
- In `AddPresentation`, register:
  - main window
  - viewmodels
  - navigation/state services used by UI

### 7.3 MVVM conventions
- Properties notify via `INotifyPropertyChanged`.
- Commands represent actions; avoid click handlers with business logic.
- UI-only value conversion in `Converters/`.
- UI-only interaction helpers in `Behaviors/`.

---

## 8) Implementation Sequence (Practical)

1. **Fix composition root and layer DI extension methods** so app starts.
2. **Apply MaterialDesign resources** and build static UI screens.
3. Add `ViewModels` and bind designs to fake/in-memory data.
4. Implement Domain models and rules.
5. Implement Application use-cases and interfaces.
6. Implement Infrastructure repositories/adapters.
7. Replace fake UI data with real Application use-cases through DI.

---

## 9) Build/Run Verification Checklist

- `dotnet build .\PrintBit.slnx` succeeds.
- App starts and shows `MainWindow`.
- MaterialDesign styles render in window.
- No direct infra calls from XAML/code-behind.
- Use-case path works: ViewModel -> Application service -> Domain behavior -> Infrastructure persistence.

---

## 10) Minimal Starter Tasks per Layer

## Domain
- Add one entity + one value object + one enum with real invariants.

## Application
- Add one use-case service + request/response DTO + repository interface.

## Infrastructure
- Add SQLite `DbContext` + one repository implementation + DI registration.

## Presentation
- Add one View + one ViewModel + one command + bindings + navigation from `MainWindow`.

If this vertical slice runs end-to-end, scale feature-by-feature using the same pattern.
