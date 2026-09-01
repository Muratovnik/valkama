# Vulture whitelist: names vulture reports as unused that are reached in a way
# it cannot see. Reading this file is what makes those names "used".
#
# It is no longer a baseline. Everything here is explained by the comment above
# it; the backlog it used to carry — speculative method synonyms, unreachable
# registry operations, constants nobody read — was deleted rather than listed,
# so a new finding fails the gate instead of joining a pile.
#
# Regenerate with `vulture <paths> --make-whitelist`, then re-review.

# The standard library calls these on its own subclass, never this code:
# `log_message` is BaseHTTPRequestHandler's logging hook, `do_PUT` is dispatched
# by method name, and `row_factory` is read by sqlite3 on every fetch.
_.log_message  # unused method (server\http_surface.py)
_.do_PUT  # unused method (server\http_surface.py)
_.do_OPTIONS  # unused method (server\http_surface.py)
_.close_connection  # unused attribute (server\http_surface.py)
_.row_factory  # unused attribute (server\improvements\improvements.py)
_.row_factory  # unused attribute (server\improvements\improvements_integration.py)
_.row_factory  # unused attribute (server\projects\scopes.py)
_.row_factory  # unused attribute (server\store.py)
_.row_factory  # unused attribute (tests\test_platform_black_box.py)
_.row_factory  # unused attribute (tests\test_platform_relations.py)

# Hypothesis calls these by decorator, not by name: @rule and @invariant
# register a method on the state machine, and teardown is the framework's own
# hook. Vulture sees a class whose methods nobody calls, which is exactly what
# a state machine looks like from the outside.
_.teardown  # unused method (tests\test_board_properties.py)
_.transition  # unused method (tests\test_board_properties.py)
_.a_stale_revision_is_refused  # unused method (tests\test_board_properties.py)
_.set_checklist  # unused method (tests\test_board_properties.py)
_.tick  # unused method (tests\test_board_properties.py)
_.summarize  # unused method (tests\test_board_properties.py)
_.a_state_orders_its_items_uniquely  # unused method (tests\test_board_properties.py)
_.a_revision_never_goes_backwards  # unused method (tests\test_board_properties.py)

# `redirect_request` is urllib's own hook: `build_opener` calls it by name on
# every 3xx, and its six arguments are the framework's signature. Refusing a
# redirect means overriding it to return None, which reads as dead code from
# outside and is the only way to say no.
_.redirect_request  # unused method (server\platform	ransports.py)
_.req  # unused variable (server\platform	ransports.py)
_.fp  # unused variable (server\platform	ransports.py)
_.newurl  # unused variable (server\platform	ransports.py)
