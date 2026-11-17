import pytest

from punk_records import authz
from punk_records.authz import (
    SHARED, Forbidden, Invalid, NotFound, build_filter, can_modify, check_readable,
    postfilter, require_global, resolve_write_project, sanitize_metadata,
    validate_client_filters, visible_projects,
)
from punk_records.config import Agent
from punk_records.config import SHARED as CONFIG_SHARED

KNOWN = frozenset({"p1", "p2", "p3"})
A = Agent("A", "agent", ("p1",), "h1")
MULTI = Agent("M", "agent", ("p1", "p2"), "h2")
NONE = Agent("N", "agent", (), "h5")
ADMIN = Agent("ADM", "project_admin", ("p1",), "h3")
G = Agent("G", "global", (), "h4")


def res(project, neighbors=None, meta_project="same"):
    meta = {"project": project if meta_project == "same" else meta_project}
    if meta_project is None:
        meta = {}
    if neighbors is not None:
        meta["context_neighbors"] = neighbors
    return {"id": f"id-{project}", "text": "t", "project": project, "metadata": meta}


def nb(project):
    return {"id": f"n-{project}", "payload": "x",
            "metadata": {} if project is None else {"project": project}}


# --- constantes / visibilidade ---

def test_shared_is_reexported_from_config():
    assert SHARED is CONFIG_SHARED
    assert authz.RESERVED == frozenset({"agent_id", "project", "created_by_role", "context_neighbors"})
    assert authz.ALLOWED_OPS == frozenset(
        {"$eq", "$ne", "$in", "$nin", "$gt", "$gte", "$lt", "$lte"})


def test_visible_projects():
    assert visible_projects(A) == frozenset({"p1", SHARED})
    assert visible_projects(ADMIN) == frozenset({"p1", SHARED})
    assert visible_projects(G) is None


# --- build_filter ---

def test_agent_filter_is_in_projects_plus_shared():
    assert build_filter(A, None, None) == {"project": {"$in": ["_shared", "p1"]}}


def test_global_filter_has_no_project_key():
    assert build_filter(G, None, {"tag": "k"}) == {"tag": "k"}


def test_explicit_project_filter():
    assert build_filter(A, "p1", None) == {"project": "p1"}
    assert build_filter(A, SHARED, None) == {"project": SHARED}
    assert build_filter(G, "p2", None) == {"project": "p2"}


def test_project_outside_list_forbidden():
    with pytest.raises(Forbidden):
        build_filter(A, "p2", None)
    with pytest.raises(Forbidden):
        build_filter(ADMIN, "p2", None)


def test_build_filter_keeps_client_filters():
    assert build_filter(A, None, {"tag": {"$in": ["a"]}}) == {
        "tag": {"$in": ["a"]}, "project": {"$in": ["_shared", "p1"]}}


def test_build_filter_rejects_reserved_client_key():
    with pytest.raises(Invalid):
        build_filter(A, None, {"project": "p2"})
    with pytest.raises(Invalid):
        build_filter(G, None, {"agent_id": "X"})


# --- validate_client_filters ---

@pytest.mark.parametrize("key", ["project", "agent_id", "created_by_role", "context_neighbors", "_deleted", "_x"])
def test_client_filter_reserved_key_invalid(key):
    with pytest.raises(Invalid):
        validate_client_filters({key: "v"})


@pytest.mark.parametrize("f", [
    {"x": {"$regex": "a"}},
    {"x": {"$eq": 1, "$where": "1"}},
    {"x": {"y": 1}},
    {"x": {}},
    {"x": {"$in": 1}},
    {"x": {"$nin": "ab"}},
    {"x": {"$gt": [1]}},
    {"x": {"$eq": {"a": 1}}},
    {"$or": [{"project": "p2"}]},
    {1: "v"},
])
def test_unknown_operator_invalid(f):
    with pytest.raises(Invalid):
        validate_client_filters(f)


def test_client_filter_not_dict_invalid():
    with pytest.raises(Invalid):
        validate_client_filters(["project"])


def test_client_filter_valid_returns_copy():
    f = {"tag": "k", "n": {"$gte": 1, "$lt": 5}}
    out = validate_client_filters(f)
    assert out == f and out is not f
    out["project"] = "p1"
    assert "project" not in f
    assert validate_client_filters(None) == {}


# --- resolve_write_project ---

def test_write_single_project_default():
    assert resolve_write_project(A, None, KNOWN) == "p1"


def test_write_multi_project_requires_project():
    with pytest.raises(Invalid):
        resolve_write_project(MULTI, None, KNOWN)
    with pytest.raises(Invalid):
        resolve_write_project(NONE, None, KNOWN)
    assert resolve_write_project(MULTI, "p2", KNOWN) == "p2"


def test_write_shared_allowed():
    assert resolve_write_project(A, SHARED, KNOWN) == SHARED
    assert resolve_write_project(NONE, SHARED, KNOWN) == SHARED
    assert resolve_write_project(G, SHARED, KNOWN) == SHARED


def test_write_outside_list_forbidden():
    with pytest.raises(Forbidden):
        resolve_write_project(A, "p2", KNOWN)
    with pytest.raises(Forbidden):
        resolve_write_project(ADMIN, "p2", KNOWN)


def test_write_own_project_no_longer_known_invalid():
    with pytest.raises(Invalid):
        resolve_write_project(A, "p1", frozenset({"p2"}))


def test_global_write_any_known_project():
    assert resolve_write_project(G, "p3", KNOWN) == "p3"


def test_global_write_unknown_project_invalid():
    with pytest.raises(Invalid):
        resolve_write_project(G, "nope", KNOWN)


def test_global_write_requires_project():
    with pytest.raises(Invalid):
        resolve_write_project(G, None, KNOWN)


# --- sanitize_metadata ---

def test_sanitize_strips_and_stamps():
    meta = {"project": "Y", "agent_id": "B", "_deleted": True, "tag": "k"}
    assert sanitize_metadata(A, "p1", meta) == {
        "tag": "k", "agent_id": "A", "project": "p1", "created_by_role": "agent"}
    assert meta["agent_id"] == "B"


def test_sanitize_none_and_role_stamp():
    assert sanitize_metadata(G, "p2", {"created_by_role": "global"} | {"x": 1}) == {
        "x": 1, "agent_id": "G", "project": "p2", "created_by_role": "global"}
    assert sanitize_metadata(A, "p1", None) == {
        "agent_id": "A", "project": "p1", "created_by_role": "agent"}


# --- can_modify ---

@pytest.mark.parametrize("agent,meta,expected", [
    (A, {"project": "p1", "agent_id": "A"}, True),           # agent: própria
    (A, {"project": "p1", "agent_id": "B"}, False),          # agent: alheia
    (A, {"project": SHARED, "agent_id": "A"}, True),         # agent: própria em _shared
    (A, {"project": SHARED, "agent_id": "B"}, False),        # agent: alheia em _shared
    (A, {"project": "p2", "agent_id": "A"}, False),          # própria, mas projeto não visível
    (A, {"agent_id": "A"}, False),                           # sem project -> fail closed
    (ADMIN, {"project": "p1", "agent_id": "B"}, True),       # admin: no projeto
    (ADMIN, {"project": "p2", "agent_id": "B"}, False),      # admin: fora
    (ADMIN, {"project": SHARED, "agent_id": "B"}, False),    # admin não cura _shared
    (ADMIN, {"project": SHARED, "agent_id": "ADM"}, True),   # admin: própria em _shared
    (G, {"project": "p2", "agent_id": "B"}, True),           # global: tudo
    (G, {}, True),
])
def test_can_modify_matrix(agent, meta, expected):
    assert can_modify(agent, meta) is expected


# --- postfilter ---

def test_postfilter_drops_foreign_result_and_counts():
    results = [res("p1"), res("p2"), res(SHARED), res("p3")]
    out, violations = postfilter(A, results)
    assert [r["project"] for r in out] == ["p1", SHARED]
    assert violations == 2


def test_postfilter_result_without_project_is_dropped():
    r = res("p1", meta_project=None)
    out, violations = postfilter(A, [r, {"id": "x", "metadata": {"project": "p1"}}])
    assert out == [] and violations == 2


def test_postfilter_result_with_mismatched_meta_project_is_dropped():
    out, violations = postfilter(A, [res("p1", meta_project="p2")])
    assert out == [] and violations == 1


def test_postfilter_drops_foreign_neighbors():
    r = res("p1", neighbors=[nb("p1"), nb("p2"), nb(SHARED), nb(None)])
    out, violations = postfilter(A, [r])
    assert violations == 0
    assert [n["metadata"]["project"] for n in out[0]["metadata"]["context_neighbors"]] == [
        "p1", SHARED]
    # entrada não é mutada
    assert len(r["metadata"]["context_neighbors"]) == 4


def test_postfilter_global_keeps_everything():
    results = [res("p2", neighbors=[nb("p3"), nb(None)]), res("p1", meta_project=None)]
    out, violations = postfilter(G, results)
    assert out == results and violations == 0


# --- require_global / check_readable ---

def test_require_global():
    require_global(G)
    for a in (A, ADMIN):
        with pytest.raises(Forbidden):
            require_global(a)


def test_check_readable_foreign_is_not_found():
    with pytest.raises(NotFound):
        check_readable(A, {"project": "p2"})
    with pytest.raises(NotFound):
        check_readable(A, {})
    with pytest.raises(NotFound):
        check_readable(A, None)
    check_readable(A, {"project": "p1"})
    check_readable(A, {"project": SHARED})
    check_readable(G, {"project": "p2"})


def test_sanitize_strips_context_neighbors():
    assert "context_neighbors" not in sanitize_metadata(A, "p1", {"context_neighbors": [1], "k": 1})


def test_strip_reserved():
    assert authz.strip_reserved({"project": "Y", "context_neighbors": [], "_d": 1, "k": 2}) == {"k": 2}
    assert authz.strip_reserved(None) == {}


def test_build_filter_project_comes_first():
    assert list(build_filter(A, "p1", {"x": 1}))[0] == "project"
    assert list(build_filter(A, None, {"x": 1}))[0] == "project"
    assert list(build_filter(G, "p1", {"x": 1}))[0] == "project"
    assert "project" not in build_filter(G, None, {"x": 1})
