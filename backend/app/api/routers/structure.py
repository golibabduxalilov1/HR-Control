"""Branches, departments, positions, cabinet users."""

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import func, select, update

from app.core.deps import DB, AdminOnly, Auth
from app.core.security import hash_password
from app.models import Branch, CabinetUser, Department, Employee, EmployeeStatus, License, Position, UserRole
from app.schemas import (
    AssignEmployeesIn,
    BranchIn,
    BranchOut,
    CabinetUserIn,
    CabinetUserOut,
    DepartmentIn,
    DepartmentOut,
    PositionIn,
    PositionOut,
)
from app.services.audit import log_action

router = APIRouter(tags=["structure"])


async def _employee_counts(db, project_id: int, column):
    rows = await db.execute(
        select(column, func.count(Employee.id))
        .where(Employee.project_id == project_id, Employee.deleted_at.is_(None), Employee.status != EmployeeStatus.dismissed)
        .group_by(column)
    )
    return {k: v for k, v in rows}


# ------------------------------------------------------------------ branches


@router.get("/branches", response_model=list[BranchOut])
async def list_branches(p: Auth, db: DB):
    counts = await _employee_counts(db, p.project.id, Employee.branch_id)
    rows = (await db.execute(select(Branch).where(Branch.project_id == p.project.id).order_by(Branch.id))).scalars()
    return [BranchOut(id=b.id, name=b.name, address=b.address, employee_count=counts.get(b.id, 0)) for b in rows]


@router.post("/branches", response_model=BranchOut, status_code=201)
async def create_branch(data: BranchIn, p: AdminOnly, db: DB, request: Request):
    lic = (await db.execute(select(License).where(License.project_id == p.project.id))).scalar_one_or_none()
    count = (await db.execute(select(func.count(Branch.id)).where(Branch.project_id == p.project.id))).scalar_one()
    if lic and lic.max_branches and count >= lic.max_branches:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, f"Лимит филиалов по лицензии: {lic.max_branches}")
    b = Branch(project_id=p.project.id, name=data.name.strip(), address=data.address)
    db.add(b)
    await log_action(db, project_id=p.project.id, actor=p.username, category="structure", action="branch_create",
                     details=f"Создан филиал «{b.name}»", request=request)
    await db.commit()
    return BranchOut(id=b.id, name=b.name, address=b.address)


@router.patch("/branches/{branch_id}", response_model=BranchOut)
async def update_branch(branch_id: int, data: BranchIn, p: AdminOnly, db: DB):
    b = await db.get(Branch, branch_id)
    if not b or b.project_id != p.project.id:
        raise HTTPException(404)
    b.name, b.address = data.name.strip(), data.address
    await db.commit()
    return BranchOut(id=b.id, name=b.name, address=b.address)


@router.delete("/branches/{branch_id}", status_code=204)
async def delete_branch(branch_id: int, p: AdminOnly, db: DB, request: Request):
    b = await db.get(Branch, branch_id)
    if not b or b.project_id != p.project.id:
        raise HTTPException(404)
    await db.delete(b)
    await log_action(db, project_id=p.project.id, actor=p.username, category="structure", action="branch_delete",
                     details=f"Удалён филиал «{b.name}»", request=request)
    await db.commit()


@router.post("/branches/{branch_id}/assign-employees")
async def branch_assign(branch_id: int, data: AssignEmployeesIn, p: AdminOnly, db: DB):
    await db.execute(update(Employee).where(Employee.project_id == p.project.id, Employee.id.in_(data.employee_ids)).values(branch_id=branch_id))
    await db.commit()
    return {"ok": True, "count": len(data.employee_ids)}


# ------------------------------------------------------------------ departments


def _build_tree(rows: list[Department], counts: dict) -> list[DepartmentOut]:
    nodes = {d.id: DepartmentOut(id=d.id, name=d.name, parent_id=d.parent_id, branch_id=d.branch_id, employee_count=counts.get(d.id, 0), children=[]) for d in rows}
    roots: list[DepartmentOut] = []
    for d in rows:
        node = nodes[d.id]
        if d.parent_id and d.parent_id in nodes:
            nodes[d.parent_id].children.append(node)
        else:
            roots.append(node)
    return roots


@router.get("/departments", response_model=list[DepartmentOut])
async def list_departments(p: Auth, db: DB):
    counts = await _employee_counts(db, p.project.id, Employee.department_id)
    rows = (await db.execute(select(Department).where(Department.project_id == p.project.id).order_by(Department.sort_order, Department.id))).scalars().all()
    return [DepartmentOut(id=d.id, name=d.name, parent_id=d.parent_id, branch_id=d.branch_id, employee_count=counts.get(d.id, 0)) for d in rows]


@router.get("/departments/tree", response_model=list[DepartmentOut])
async def department_tree(p: Auth, db: DB):
    counts = await _employee_counts(db, p.project.id, Employee.department_id)
    rows = (await db.execute(select(Department).where(Department.project_id == p.project.id).order_by(Department.sort_order, Department.id))).scalars().all()
    return _build_tree(rows, counts)


@router.post("/departments", response_model=DepartmentOut, status_code=201)
async def create_department(data: DepartmentIn, p: AdminOnly, db: DB, request: Request):
    d = Department(project_id=p.project.id, name=data.name.strip(), parent_id=data.parent_id, branch_id=data.branch_id)
    db.add(d)
    await log_action(db, project_id=p.project.id, actor=p.username, category="structure", action="department_create",
                     details=f"Создано подразделение «{d.name}»", request=request)
    await db.commit()
    return DepartmentOut(id=d.id, name=d.name, parent_id=d.parent_id, branch_id=d.branch_id)


@router.patch("/departments/{dep_id}", response_model=DepartmentOut)
async def update_department(dep_id: int, data: DepartmentIn, p: AdminOnly, db: DB):
    d = await db.get(Department, dep_id)
    if not d or d.project_id != p.project.id:
        raise HTTPException(404)
    if data.parent_id == dep_id:
        raise HTTPException(400, "Подразделение не может быть родителем самого себя")
    d.name, d.parent_id, d.branch_id = data.name.strip(), data.parent_id, data.branch_id
    await db.commit()
    return DepartmentOut(id=d.id, name=d.name, parent_id=d.parent_id, branch_id=d.branch_id)


@router.delete("/departments/{dep_id}", status_code=204)
async def delete_department(dep_id: int, p: AdminOnly, db: DB, request: Request):
    d = await db.get(Department, dep_id)
    if not d or d.project_id != p.project.id:
        raise HTTPException(404)
    await db.execute(update(Employee).where(Employee.department_id == dep_id).values(department_id=None, position_id=None))
    await db.execute(update(Department).where(Department.parent_id == dep_id).values(parent_id=d.parent_id))
    await db.delete(d)
    await log_action(db, project_id=p.project.id, actor=p.username, category="structure", action="department_delete",
                     details=f"Удалено подразделение «{d.name}»", request=request)
    await db.commit()


@router.post("/departments/{dep_id}/assign-employees")
async def department_assign(dep_id: int, data: AssignEmployeesIn, p: AdminOnly, db: DB):
    d = await db.get(Department, dep_id)
    if not d or d.project_id != p.project.id:
        raise HTTPException(404)
    await db.execute(update(Employee).where(Employee.project_id == p.project.id, Employee.id.in_(data.employee_ids)).values(department_id=dep_id, position_id=None))
    await db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ positions


@router.get("/positions", response_model=list[PositionOut])
async def list_positions(p: Auth, db: DB):
    counts = await _employee_counts(db, p.project.id, Employee.position_id)
    rows = await db.execute(
        select(Position, Department.name).outerjoin(Department, Department.id == Position.department_id)
        .where(Position.project_id == p.project.id).order_by(Position.id)
    )
    return [PositionOut(id=pos.id, name=pos.name, department_id=pos.department_id, department_name=dn, employee_count=counts.get(pos.id, 0)) for pos, dn in rows]


@router.post("/positions", response_model=PositionOut, status_code=201)
async def create_position(data: PositionIn, p: AdminOnly, db: DB):
    pos = Position(project_id=p.project.id, name=data.name.strip(), department_id=data.department_id)
    db.add(pos)
    await db.commit()
    return PositionOut(id=pos.id, name=pos.name, department_id=pos.department_id)


@router.patch("/positions/{pos_id}", response_model=PositionOut)
async def update_position(pos_id: int, data: PositionIn, p: AdminOnly, db: DB):
    pos = await db.get(Position, pos_id)
    if not pos or pos.project_id != p.project.id:
        raise HTTPException(404)
    pos.name, pos.department_id = data.name.strip(), data.department_id
    await db.commit()
    return PositionOut(id=pos.id, name=pos.name, department_id=pos.department_id)


@router.delete("/positions/{pos_id}", status_code=204)
async def delete_position(pos_id: int, p: AdminOnly, db: DB):
    pos = await db.get(Position, pos_id)
    if not pos or pos.project_id != p.project.id:
        raise HTTPException(404)
    await db.execute(update(Employee).where(Employee.position_id == pos_id).values(position_id=None))
    await db.delete(pos)
    await db.commit()


@router.post("/positions/{pos_id}/assign-employees")
async def position_assign(pos_id: int, data: AssignEmployeesIn, p: AdminOnly, db: DB):
    pos = await db.get(Position, pos_id)
    if not pos or pos.project_id != p.project.id:
        raise HTTPException(404)
    values = {"position_id": pos_id}
    if pos.department_id:
        values["department_id"] = pos.department_id
    await db.execute(update(Employee).where(Employee.project_id == p.project.id, Employee.id.in_(data.employee_ids)).values(**values))
    await db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ cabinet users


@router.get("/cabinet-users", response_model=list[CabinetUserOut])
async def list_users(p: AdminOnly, db: DB):
    rows = await db.execute(
        select(CabinetUser, Branch.name).outerjoin(Branch, Branch.id == CabinetUser.branch_id)
        .where(CabinetUser.project_id == p.project.id).order_by(CabinetUser.id)
    )
    return [CabinetUserOut(id=u.id, username=u.username, display_name=u.display_name, role=u.role.value,
                           branch_id=u.branch_id, branch_name=bn, is_active=u.is_active) for u, bn in rows]


@router.post("/cabinet-users", response_model=CabinetUserOut, status_code=201)
async def create_user(data: CabinetUserIn, p: AdminOnly, db: DB, request: Request):
    exists = (await db.execute(select(CabinetUser).where(CabinetUser.project_id == p.project.id, CabinetUser.username == data.username))).scalar_one_or_none()
    if exists:
        raise HTTPException(409, "Логин уже занят")
    u = CabinetUser(project_id=p.project.id, username=data.username.strip(), password_hash=hash_password(data.password),
                    display_name=data.display_name or data.username, role=UserRole(data.role), branch_id=data.branch_id)
    db.add(u)
    await log_action(db, project_id=p.project.id, actor=p.username, category="auth", action="user_create",
                     details=f"Создан логин {u.username} ({u.role.value})", request=request)
    await db.commit()
    return CabinetUserOut(id=u.id, username=u.username, display_name=u.display_name, role=u.role.value, branch_id=u.branch_id, is_active=u.is_active)


@router.patch("/cabinet-users/{user_id}", response_model=CabinetUserOut)
async def update_user(user_id: int, data: dict, p: AdminOnly, db: DB):
    u = await db.get(CabinetUser, user_id)
    if not u or u.project_id != p.project.id:
        raise HTTPException(404)
    if "password" in data and data["password"]:
        u.password_hash = hash_password(data["password"])
    for key in ("display_name", "branch_id", "is_active"):
        if key in data:
            setattr(u, key, data[key])
    if "role" in data:
        u.role = UserRole(data["role"])
    await db.commit()
    return CabinetUserOut(id=u.id, username=u.username, display_name=u.display_name, role=u.role.value, branch_id=u.branch_id, is_active=u.is_active)


@router.delete("/cabinet-users/{user_id}", status_code=204)
async def delete_user(user_id: int, p: AdminOnly, db: DB):
    u = await db.get(CabinetUser, user_id)
    if not u or u.project_id != p.project.id:
        raise HTTPException(404)
    if u.id == p.user.id:
        raise HTTPException(400, "Нельзя удалить самого себя")
    await db.delete(u)
    await db.commit()
